// Sports digest: emails a user their followed teams' recent scores + upcoming
// games. Two entry points:
//   • GET  (Vercel Cron) — daily run; sends to every user with sportsConfig
//     enabled who hasn't been sent today. On the Hobby plan the cron fires once
//     a day, so the per-user send-time is stored but not enforced to the hour.
//   • POST { uid, test: true } — "Send test now" button; sends that user's
//     digest immediately to their own account email, ignoring the daily dedupe.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { fetchSeasonWithPhases } from '../lib/espnSeason.js';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) initializeApp({ credential: cert(sa) });
}

// YYYY-MM-DD in a given IANA timezone (defaults to US Eastern).
function localDateKey(date, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

const WEEKDAY_IDX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Weekday (0=Sun) in a given IANA timezone.
function localWeekday(date, tz) {
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', weekday: 'short' }).format(date);
    return WEEKDAY_IDX[s] ?? date.getUTCDay();
  } catch {
    return date.getUTCDay();
  }
}

// Whether a user's digest should go out on this cron run, per their frequency.
// Daily → every run; weekly → only on the chosen weekday; monthly → only on the
// chosen day-of-month (capped at 28 in the UI so it fires every month).
function isDueToday(cfg, now) {
  const freq = cfg.frequency || 'daily';
  if (freq === 'weekly') {
    return localWeekday(now, cfg.timezone) === (typeof cfg.sendWeekday === 'number' ? cfg.sendWeekday : 1);
  }
  if (freq === 'monthly') {
    const dom = parseInt(localDateKey(now, cfg.timezone).slice(8, 10), 10);
    return dom === (typeof cfg.sendDayOfMonth === 'number' ? cfg.sendDayOfMonth : 1);
  }
  return true; // daily
}

// Day and clock are formatted separately so game rows can stack them in a
// narrow left-hand column instead of running one long date string.
function fmtGameDay(iso, tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'America/New_York',
      weekday: 'short', month: 'short', day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleDateString();
  }
}

function fmtGameClock(iso, tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'America/New_York',
      hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

// ESPN ships several logo variants per team; the plain "default" one is the
// full-colour badge that reads best on the email's light background.
function pickLogo(team) {
  const logos = team?.logos || [];
  const preferred = logos.find((l) => (l.rel || []).includes('default')) || logos[0];
  return preferred?.href || team?.logo || '';
}

// 18px badge, alt-texted with the abbreviation so it still reads in clients
// that block remote images.
const logoImg = (src, alt) => (src
  ? `<img src="${src}" alt="${alt}" width="18" height="18" style="width:18px;height:18px;border:0;vertical-align:middle;" />`
  : '');

// The content sections a digest can include. Any key not explicitly set to
// false is treated as on, so newly added topics default on for existing
// configs (and legacy configs with no topics field get everything).
const DEFAULT_TOPICS = { scores: true, upcoming: true, standings: true, seasons: true };
function normalizeTopics(cfg) {
  const t = cfg?.topics;
  if (!t || typeof t !== 'object') return { ...DEFAULT_TOPICS };
  return {
    scores: t.scores !== false,
    upcoming: t.upcoming !== false,
    standings: t.standings !== false,
    seasons: t.seasons !== false,
  };
}

// Recent results + upcoming games from the team's schedule endpoint.
async function fetchTeamSchedule(team) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${team.sportPath}/teams/${team.teamId}/schedule`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  const data = await res.json();
  const now = Date.now();
  const DAY = 86400000;

  const results = [];
  const upcoming = [];
  for (const ev of data.events || []) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const when = new Date(ev.date).getTime();
    const completed = !!comp.status?.type?.completed;
    const competitors = (comp.competitors || []).map((c) => ({
      abbrev: c.team?.abbreviation || c.team?.shortDisplayName || '?',
      name: c.team?.displayName || c.team?.shortDisplayName || c.team?.abbreviation || '',
      logo: pickLogo(c.team),
      home: c.homeAway === 'home',
      score: c.score?.displayValue ?? (c.score != null ? String(c.score) : ''),
      winner: !!c.winner,
    }));
    if (completed && when >= now - 3 * DAY) {
      results.push({ when, iso: ev.date, competitors });
    } else if (!completed && when >= now - 6 * 3600000) {
      upcoming.push({ when, iso: ev.date, competitors });
    }
  }
  results.sort((a, b) => a.when - b.when);
  upcoming.sort((a, b) => a.when - b.when);
  return { results, upcoming: upcoming.slice(0, 3) };
}

// Overall W-L record + division standing from the team info endpoint. Used as
// the fallback line when the full standings table can't be built.
async function fetchTeamStanding(team) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${team.sportPath}/teams/${team.teamId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  const data = await res.json();
  const t = data.team || {};
  const record = (t.record?.items || []).find((i) => i.type === 'total')?.summary || '';
  return { record, standing: t.standingSummary || '' };
}

// League standings at division level. One fetch per league per send — the
// payload covers every division, so it's cached by sportPath in `cache`.
function fetchLeagueStandings(sportPath, cache) {
  if (!cache.has(sportPath)) {
    cache.set(sportPath, (async () => {
      const res = await fetch(`https://site.api.espn.com/apis/v2/sports/${sportPath}/standings?level=3`);
      if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
      return res.json();
    })());
  }
  return cache.get(sportPath);
}

// The standings tree nests league → conference → division; only the leaves
// carry entries, so walk it and keep every node that has a table.
function collectStandingsGroups(node, path = []) {
  const trail = node?.name ? [...path, node.name] : path;
  const out = [];
  if (node?.standings?.entries?.length) {
    out.push({ name: node.name || trail[trail.length - 1] || 'Standings', entries: node.standings.entries });
  }
  for (const child of node?.children || []) out.push(...collectStandingsGroups(child, trail));
  return out;
}

const statValue = (entry, name) => (entry.stats || []).find((s) => s.name === name)?.displayValue;

// One row per club in the group, ordered the way a standings page would show
// it. ESPN returns the entries in no dependable order (the NBA comes back
// scrambled), so sort by games behind, then win pct, then name.
function standingsRows(entries) {
  return entries
    .map((e) => {
      const gbText = statValue(e, 'gamesBehind');
      const behind = gbText && gbText !== '-' ? parseFloat(gbText) : 0;
      const wins = statValue(e, 'wins');
      const losses = statValue(e, 'losses');
      const pct = parseFloat(statValue(e, 'winPercent'));
      return {
        id: String(e.team?.id ?? ''),
        name: e.team?.displayName || e.team?.shortDisplayName || '',
        abbrev: e.team?.abbreviation || '',
        logo: pickLogo(e.team),
        // NHL packs the OT column and points into `overall`; the NBA has no
        // `overall` stat at all, so fall back to plain W-L.
        record: statValue(e, 'overall') || (wins != null && losses != null ? `${wins}-${losses}` : ''),
        behind: Number.isFinite(behind) ? behind : 0,
        pct: Number.isFinite(pct) ? pct : 0,
        gb: gbText && gbText !== '-' ? `${gbText} GB` : '',
      };
    })
    .sort((a, b) => a.behind - b.behind || (b.pct || 0) - (a.pct || 0) || a.name.localeCompare(b.name));
}

// The table for the division/conference group the team actually plays in.
async function fetchTeamStandingsTable(team, cache) {
  const data = await fetchLeagueStandings(team.sportPath, cache);
  const wanted = String(team.teamId);
  const group = collectStandingsGroups(data).find((g) =>
    g.entries.some((e) => String(e.team?.id) === wanted));
  if (!group) return null;
  const rows = standingsRows(group.entries);
  return rows.length ? { group: group.name, rows } : null;
}

function seasonStatusText(season) {
  if (!season?.startDate || !season?.endDate) return 'Dates unavailable';
  const now = Date.now();
  const start = new Date(season.startDate).getTime();
  const end = new Date(season.endDate).getTime();
  const days = (ms) => Math.max(1, Math.ceil(ms / 86400000));
  if (now < start) return `Starts in ${days(start - now)} days`;
  if (now > end) return 'Season ended';
  return `In season · ${days(end - now)} days left`;
}

// Whether "now" falls inside the league's season window. Unknown dates count as
// in season so a gap in ESPN's data never silently drops a team's games.
function isSeasonActive(season) {
  if (!season?.startDate || !season?.endDate) return true;
  const now = Date.now();
  return now >= new Date(season.startDate).getTime() && now <= new Date(season.endDate).getTime();
}

// When an out-of-season league next opens. Before the window that's its own
// start date; after it closes ESPN still reports the finished season, so fall
// back to the end of the Off Season phase — that's where the next one picks up.
function nextSeasonStart(season) {
  if (!season?.startDate) return null;
  const now = Date.now();
  if (now < new Date(season.startDate).getTime()) return season.startDate;
  const off = (season.phases || []).find((p) => /off\s*season/i.test(p.name));
  if (off?.endDate && new Date(off.endDate).getTime() > now) return off.endDate;
  return null;
}

function daysUntil(iso) {
  return Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
}

function fmtSeasonDate(iso, tz) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleDateString();
  }
}

// Gather all requested content for one team, only fetching what's toggled on.
async function fetchTeamDigest(team, topics, standingsCache) {
  const out = { name: team.name, teamId: String(team.teamId), results: [], upcoming: [], record: '', standing: '', table: null };
  if (topics.scores || topics.upcoming) {
    const sched = await fetchTeamSchedule(team);
    out.results = sched.results;
    out.upcoming = sched.upcoming;
  }
  if (topics.standings) {
    try {
      out.table = await fetchTeamStandingsTable(team, standingsCache);
    } catch { /* fall back to the one-line summary below */ }
    if (!out.table) {
      try {
        const st = await fetchTeamStanding(team);
        out.record = st.record;
        out.standing = st.standing;
      } catch { /* standings are best-effort */ }
    }
  }
  return out;
}

// Every section is laid out as a real table — nested tables with inline styles
// are the only layout email clients render consistently.
const TABLE_OPEN = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;font-size:0.85rem;">';
const TH = 'font-size:0.62rem;text-transform:uppercase;letter-spacing:0.06em;color:#9ca3af;font-weight:600;padding:0 0 4px;border-bottom:1px solid #e5e7eb;';
const CELL = 'padding:5px 0;border-bottom:1px solid #f1f0ed;';

// Recent results as a scoreboard: two rows per game, winner bolded, with the
// day carried in a narrow left column that spans both.
function resultsTable(games, tz) {
  const rows = games.map((g) => {
    const away = g.competitors.find((c) => !c.home) || g.competitors[0];
    const home = g.competitors.find((c) => c.home) || g.competitors[1];
    const side = (c, last) => {
      const weight = c?.winner ? 700 : 400;
      const border = last ? CELL : 'padding:5px 0 0;';
      return `<td style="${border}color:#1f2937;font-weight:${weight};">${logoImg(c?.logo, c?.abbrev || '')} ${c?.name || c?.abbrev || '?'}</td>
        <td align="right" style="${border}color:#111827;font-weight:${weight};white-space:nowrap;">${c?.score ?? ''}</td>`;
    };
    return `
      <tr>
        <td rowspan="2" width="86" valign="middle" style="${CELL}color:#9ca3af;font-size:0.72rem;white-space:nowrap;">${fmtGameDay(g.iso, tz)}</td>
        ${side(away, false)}
      </tr>
      <tr>${side(home, true)}</tr>`;
  }).join('');
  return `${TABLE_OPEN}${rows}</table>`;
}

// Upcoming games: when on the left, matchup on the right.
function upcomingTable(games, tz) {
  const rows = games.map((g) => {
    const away = g.competitors.find((c) => !c.home) || g.competitors[0];
    const home = g.competitors.find((c) => c.home) || g.competitors[1];
    const team = (c) => `${logoImg(c?.logo, c?.abbrev || '')} ${c?.name || c?.abbrev || '?'}`;
    return `
      <tr>
        <td width="86" valign="top" style="${CELL}color:#9ca3af;font-size:0.72rem;white-space:nowrap;">
          ${fmtGameDay(g.iso, tz)}<br /><span style="color:#6b7280;">${fmtGameClock(g.iso, tz)}</span>
        </td>
        <td valign="top" style="${CELL}color:#1f2937;">${team(away)} <span style="color:#9ca3af;">@</span> ${team(home)}</td>
      </tr>`;
  }).join('');
  return `${TABLE_OPEN}${rows}</table>`;
}

// The team's whole division, so its record reads against the clubs it's
// actually chasing. The followed team's row is bolded and tinted.
function standingsTable(table, teamId) {
  const rows = table.rows.map((r, i) => {
    const me = r.id === teamId;
    const base = `${CELL}${me ? 'background:#eef2ff;' : ''}font-weight:${me ? 700 : 400};`;
    const cell = `${base}color:${me ? '#111827' : '#4b5563'};`;
    return `
      <tr>
        <td width="18" align="right" style="${base}color:#9ca3af;">${i + 1}</td>
        <td style="${cell}padding-left:8px;">${logoImg(r.logo, r.abbrev)} ${r.name}</td>
        <td align="right" style="${cell}white-space:nowrap;">${r.record}</td>
        <td align="right" style="${cell}padding-left:10px;white-space:nowrap;">${r.gb || '—'}</td>
      </tr>`;
  }).join('');
  return `
    ${TABLE_OPEN}
      <tr>
        <th align="right" width="18" style="${TH}">#</th>
        <th align="left" style="${TH}padding-left:8px;">Team</th>
        <th align="right" style="${TH}">Record</th>
        <th align="right" style="${TH}padding-left:10px;">GB</th>
      </tr>
      ${rows}
    </table>
    <div style="color:#9ca3af;font-size:0.7rem;margin-top:4px;">GB = games behind the division leader.</div>`;
}

const sectionLabel = (text, first) =>
  `<div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:${first ? '0' : '0.9rem'} 0 0.3rem;">${text}</div>`;

function buildSeasonBlock(seasons, tz) {
  if (!seasons || seasons.length === 0) return '';
  const now = Date.now();
  const rows = seasons.map(({ label, season }) => {
    const dates = season?.startDate && season?.endDate
      ? `${fmtSeasonDate(season.startDate, tz)} → ${fmtSeasonDate(season.endDate, tz)}`
      : 'Dates unavailable';
    const phaseRows = (season?.phases || []).map((p) => {
      const active = now >= new Date(p.startDate).getTime() && now <= new Date(p.endDate).getTime();
      const cell = `padding:3px 0;font-size:0.8rem;color:${active ? '#4f46e5' : '#6b7280'};font-weight:${active ? 600 : 400};`;
      return `
        <tr>
          <td style="${cell}">${p.name}${active ? ' <span style="color:#4f46e5;">— now</span>' : ''}</td>
          <td align="right" style="${cell}white-space:nowrap;">${fmtSeasonDate(p.startDate, tz)} → ${fmtSeasonDate(p.endDate, tz)}</td>
        </tr>`;
    }).join('');
    return `
      <div style="margin:0 0 0.9rem;">
        <span style="font-weight:700;color:#111827;">${label}</span>
        <span style="color:#6b7280;font-size:0.8rem;">${season?.displayName ? ' · ' + season.displayName : ''}</span>
        <div style="color:#1f2937;font-size:0.85rem;">${dates} <span style="color:#6b7280;">· ${seasonStatusText(season)}</span></div>
        ${phaseRows ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-top:4px;">${phaseRows}</table>` : ''}
      </div>`;
  }).join('');
  return `
    <div style="background:#eef2ff;border-radius:12px;padding:1rem 1.25rem;margin:0 0 1rem;">
      <h2 style="font-size:1.05rem;margin:0 0 0.5rem;color:#111827;">Season calendars</h2>
      ${rows}
    </div>`;
}

// Leagues that aren't playing right now: a compact footer listing the teams
// being skipped and when their season opens back up.
function buildOffSeasonBlock(offSeason, tz) {
  if (!offSeason || offSeason.length === 0) return '';
  const rows = offSeason.map(({ label, season, teams }) => {
    const start = nextSeasonStart(season);
    return `
      <tr>
        <td style="${CELL}color:#111827;font-weight:700;">${label}
          <div style="color:#6b7280;font-size:0.75rem;font-weight:400;">${teams.join(', ')}</div>
        </td>
        <td align="right" style="${CELL}color:#4b5563;white-space:nowrap;">
          ${start ? fmtSeasonDate(start, tz) : 'Not announced'}
          ${start ? `<div style="color:#9ca3af;font-size:0.75rem;">in ${daysUntil(start)} days</div>` : ''}
        </td>
      </tr>`;
  }).join('');
  return `
    <div style="background:#f3f4f6;border-radius:12px;padding:1rem 1.25rem;margin:0 0 1rem;">
      <h2 style="font-size:1.05rem;margin:0 0 0.15rem;color:#111827;">Out of season</h2>
      <div style="color:#9ca3af;font-size:0.8rem;margin:0 0 0.5rem;">Held until these leagues are back.</div>
      ${TABLE_OPEN}
        <tr>
          <th align="left" style="${TH}">League</th>
          <th align="right" style="${TH}">Season starts</th>
        </tr>
        ${rows}
      </table>
    </div>`;
}

function buildEmailHtml(teamDigests, tz, topics, seasons, offSeason) {
  const seasonBlock = topics.seasons ? buildSeasonBlock(seasons, tz) : '';
  const sections = teamDigests
    .map((t) => {
      const blocks = [];
      if (topics.standings && t.table) {
        blocks.push(`${sectionLabel(t.table.group, blocks.length === 0)}${standingsTable(t.table, t.teamId)}`);
      } else if (topics.standings && (t.record || t.standing)) {
        const parts = [t.record, t.standing].filter(Boolean).join(' · ');
        blocks.push(`${sectionLabel('Record &amp; standing', blocks.length === 0)}<div style="margin:2px 0;color:#1f2937;font-weight:600;">${parts}</div>`);
      }
      if (topics.scores) {
        const html = t.results.length
          ? resultsTable(t.results, tz)
          : '<div style="color:#9ca3af;">No games in the last few days.</div>';
        blocks.push(`${sectionLabel('Recent scores', blocks.length === 0)}${html}`);
      }
      if (topics.upcoming) {
        const html = t.upcoming.length
          ? upcomingTable(t.upcoming, tz)
          : '<div style="color:#9ca3af;">No upcoming games scheduled.</div>';
        blocks.push(`${sectionLabel('Upcoming', blocks.length === 0)}${html}`);
      }
      return `
        <div style="background:#f5f3ef;border-radius:12px;padding:1rem 1.25rem;margin:0 0 1rem;">
          <h2 style="font-size:1.05rem;margin:0 0 0.5rem;color:#111827;">${t.name}</h2>
          ${blocks.join('')}
        </div>`;
    })
    .join('');

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:2rem;">
      <h1 style="font-size:1.5rem;color:#4f46e5;margin:0 0 0.25rem;">Rally Sports</h1>
      <p style="color:#525252;margin:0 0 1.25rem;">Your daily rundown 🏟️</p>
      ${seasonBlock}
      ${sections || (offSeason?.length ? '<p style="color:#6b7280;margin:0 0 1rem;">None of your leagues are in season right now.</p>' : '')}
      ${buildOffSeasonBlock(offSeason, tz)}
      <p style="color:#9ca3af;font-size:0.75rem;margin-top:1.5rem;">Scores &amp; schedules via ESPN. You're getting this because you set up a Sports digest in Rally.</p>
    </div>`;
}

async function sendDigestForUser(db, resendKey, uid, userData) {
  const cfg = userData.sportsConfig || {};
  const email = cfg.email || userData.email;
  const teams = Array.isArray(cfg.teams) ? cfg.teams : [];
  if (!email) return { uid, skipped: 'no email' };
  if (teams.length === 0) return { uid, skipped: 'no teams' };

  const topics = normalizeTopics(cfg);
  if (!topics.scores && !topics.upcoming && !topics.standings && !topics.seasons) {
    return { uid, skipped: 'no topics selected' };
  }

  const tz = cfg.timezone || 'America/New_York';

  // Seasons are league-level: one per distinct league among the teams. Fetched
  // even when the calendars topic is off, because they decide which teams are
  // in season and get a full write-up.
  const byPath = new Map();
  for (const t of teams) {
    if (!byPath.has(t.sportPath)) byPath.set(t.sportPath, t.leagueLabel || t.leagueKey || t.sportPath);
  }
  const leagues = await Promise.all(
    [...byPath.entries()].map(async ([sportPath, label]) => {
      try { return { sportPath, label, season: await fetchSeasonWithPhases(sportPath) }; }
      catch { return { sportPath, label, season: null }; }
    }),
  );
  const active = new Map(leagues.map((l) => [l.sportPath, isSeasonActive(l.season)]));

  // Only in-season teams get scores/upcoming/standings; the rest are summarized
  // in the out-of-season footer, sorted by whichever league returns first.
  const inSeasonTeams = teams.filter((t) => active.get(t.sportPath) !== false);
  const standingsCache = new Map(); // one standings fetch per league, per send
  const digests = [];
  for (const team of inSeasonTeams) {
    try {
      digests.push(await fetchTeamDigest(team, topics, standingsCache));
    } catch (err) {
      digests.push({ name: team.name, teamId: String(team.teamId), results: [], upcoming: [], record: '', standing: '', table: null, error: err.message });
    }
  }

  const seasons = leagues.filter((l) => active.get(l.sportPath));
  const offSeason = leagues
    .filter((l) => !active.get(l.sportPath))
    .map((l) => ({ ...l, teams: teams.filter((t) => t.sportPath === l.sportPath).map((t) => t.name) }))
    .sort((a, b) => {
      const sa = nextSeasonStart(a.season);
      const sb = nextSeasonStart(b.season);
      if (!sa) return 1;
      if (!sb) return -1;
      return new Date(sa) - new Date(sb);
    });

  const html = buildEmailHtml(digests, tz, topics, seasons, offSeason);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Rally Sports <noreply@resend.dev>',
      to: [email],
      subject: inSeasonTeams.length
        ? `🏟️ Your Sports digest — ${inSeasonTeams.length} team${inSeasonTeams.length === 1 ? '' : 's'} in season`
        : '🏟️ Your Sports digest — all your leagues are out of season',
      html,
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return { uid, success: false, error: err.message || `HTTP ${response.status}` };
  }
  return { uid, success: true, teams: teams.length };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return res.status(200).json({ skipped: true, reason: 'No RESEND_API_KEY configured' });
  }

  let db;
  try {
    db = getFirestore();
  } catch {
    return res.status(200).json({ skipped: true, reason: 'Firebase Admin not configured.' });
  }

  // Manual "send test now" — sends one user's digest immediately to their own
  // account email (never an address from the request), bypassing the dedupe.
  if (req.method === 'POST') {
    const uid = req.body?.uid;
    if (!uid) return res.status(400).json({ error: 'uid required' });
    try {
      const snap = await db.collection('users').doc(uid).get();
      if (!snap.exists) return res.status(404).json({ error: 'user not found' });
      const result = await sendDigestForUser(db, resendKey, uid, snap.data());
      if (result.skipped) return res.status(200).json({ sent: 0, ...result });
      if (!result.success) return res.status(502).json(result);
      return res.status(200).json({ sent: 1, ...result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Cron: send each enabled user's digest when it's due (per their frequency)
  // and hasn't already gone out today.
  const now = new Date();
  const results = [];
  try {
    const usersSnap = await db.collection('users').get();
    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      const cfg = data.sportsConfig;
      if (!cfg?.enabled) continue;
      if (!isDueToday(cfg, now)) continue; // not this user's send day
      const todayKey = localDateKey(now, cfg.timezone);
      if (cfg.lastSentDate === todayKey) continue; // already sent today
      const result = await sendDigestForUser(db, resendKey, userDoc.id, data);
      if (result.success) {
        await db.collection('users').doc(userDoc.id).set(
          { sportsConfig: { lastSentDate: todayKey } },
          { merge: true },
        );
      }
      results.push(result);
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const sent = results.filter((r) => r.success).length;
  return res.status(200).json({ checked: true, sent, total: results.length, results });
}
