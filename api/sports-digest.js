// Sports digest: emails a user their followed teams' recent scores + upcoming
// games. Two entry points:
//   • GET  (Vercel Cron) — daily run; sends to every user with sportsConfig
//     enabled who hasn't been sent today. On the Hobby plan the cron fires once
//     a day, so the per-user send-time is stored but not enforced to the hour.
//   • POST { uid, test: true } — "Send test now" button; sends that user's
//     digest immediately to their own account email, ignoring the daily dedupe.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { fetchSeasonWithPhases, fetchDraftPicks } from '../lib/espnSeason.js';

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
const DEFAULT_TOPICS = { scores: true, upcoming: true, standings: true, seasons: true, draft: true };
function normalizeTopics(cfg) {
  const t = cfg?.topics;
  if (!t || typeof t !== 'object') return { ...DEFAULT_TOPICS };
  return {
    scores: t.scores !== false,
    upcoming: t.upcoming !== false,
    standings: t.standings !== false,
    seasons: t.seasons !== false,
    draft: t.draft !== false,
  };
}

// ESPN season type 1 is the exhibition phase — "Preseason" everywhere, "Spring
// Training" in MLB. Those games don't count, so they stay out of the digest.
const isPreseasonEvent = (ev) => Number(ev?.seasonType?.type) === 1;

async function fetchScheduleEvents(team, seasonType) {
  const q = seasonType ? `?seasontype=${seasonType}` : '';
  const url = `https://site.api.espn.com/apis/site/v2/sports/${team.sportPath}/teams/${team.teamId}/schedule${q}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  const data = await res.json();
  return data.events || [];
}

// Recent results + upcoming games from the team's schedule endpoint, exhibition
// games excluded. The endpoint defaults to whichever phase the league is in
// right now, so through August an NFL team comes back with nothing BUT
// preseason — ask for the regular season explicitly when that's what we got, or
// dropping the exhibitions would just leave the section empty. If the regular
// season isn't published yet (the NBA in August), there's genuinely nothing to
// show and the team falls away, which is the right answer.
async function fetchTeamSchedule(team) {
  let events = await fetchScheduleEvents(team);
  if (events.some(isPreseasonEvent)) {
    const regular = await fetchScheduleEvents(team, 2).catch(() => []);
    if (regular.length) events = regular;
  }
  events = events.filter((ev) => !isPreseasonEvent(ev));
  const now = Date.now();
  const DAY = 86400000;

  const results = [];
  const upcoming = [];
  for (const ev of events) {
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
  // The week ahead, so a daily sport shows the whole slate rather than the next
  // few days. Sports that play once a week would be down to a single fixture on
  // that rule, so fall back to the next three whenever the week is thinner.
  const thisWeek = upcoming.filter((g) => g.when <= now + 7 * DAY);
  return { results, upcoming: thisWeek.length >= 3 ? thisWeek : upcoming.slice(0, 3) };
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

// Standings at a given grouping level: 1 = the whole league, 3 = divisions.
// One fetch per league per level per send — each payload covers every club at
// that level, so it's cached and shared by all teams in the league.
function fetchLeagueStandings(sportPath, cache, level) {
  const key = `${sportPath}:${level}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const res = await fetch(`https://site.api.espn.com/apis/v2/sports/${sportPath}/standings?level=${level}`);
      if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
      return res.json();
    })());
  }
  return cache.get(key);
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

// The table, at one grouping level, for whichever group the team sits in.
async function standingsGroupFor(team, cache, level) {
  const data = await fetchLeagueStandings(team.sportPath, cache, level);
  const wanted = String(team.teamId);
  const group = collectStandingsGroups(data).find((g) =>
    g.entries.some((e) => String(e.team?.id) === wanted));
  if (!group) return null;
  const rows = standingsRows(group.entries);
  return rows.length ? { group: group.name, rows } : null;
}

// Both views of where the team sits: its division, and the league as a whole.
// Either can come back null and the other still renders on its own.
async function fetchTeamStandingsTable(team, cache) {
  const [division, national] = await Promise.all([
    standingsGroupFor(team, cache, 3).catch(() => null),
    standingsGroupFor(team, cache, 1).catch(() => null),
  ]);
  return division || national ? { division, national } : null;
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

// One standings table. The followed team's row is bolded and tinted so it's
// findable at a glance in a 30-row league table.
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
    </table>`;
}

// Division on the left, the whole league on the right, so the team's place in
// its own race sits next to its place in the league. The two-column row is a
// table (the only side-by-side email clients agree on); the `stack` class lets
// clients that honour media queries drop it to one column on narrow screens.
function standingsBlock(tables, teamId) {
  const panels = [
    tables.division && { caption: tables.division.group, table: tables.division },
    tables.national && { caption: tables.national.group, table: tables.national },
  ].filter(Boolean);
  const caption = (text) =>
    `<div style="font-size:0.72rem;font-weight:700;color:#374151;margin:0 0 4px;">${text}</div>`;
  const legend = `<div style="color:#9ca3af;font-size:0.7rem;margin-top:6px;">GB = games behind the leader of that table.</div>`;

  if (panels.length === 1) {
    return `${caption(panels[0].caption)}${standingsTable(panels[0].table, teamId)}${legend}`;
  }
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
      <tr>
        ${panels.map((p, i) => `
        <td class="stack" width="50%" valign="top" style="${i === 0 ? 'padding-right:10px;' : 'padding-left:10px;'}">
          ${caption(p.caption)}${standingsTable(p.table, teamId)}
        </td>`).join('')}
      </tr>
    </table>
    ${legend}`;
}

const sectionLabel = (text, first) =>
  `<div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:${first ? '0' : '0.9rem'} 0 0.3rem;">${text}</div>`;

// The phase covering right now, if ESPN has one for this moment.
function currentPhase(season) {
  const now = Date.now();
  return (season?.phases || []).find((p) =>
    now >= new Date(p.startDate).getTime() && now <= new Date(p.endDate).getTime()) || null;
}

// Where each in-season league stands today — one row per league. The full
// phase-by-phase calendar stays on the Sports page; the email only answers
// "what part of the season is this, and how much of it is left".
function buildSeasonBlock(seasons, tz) {
  if (!seasons || seasons.length === 0) return '';
  const rows = seasons.map(({ label, season }) => {
    const phase = currentPhase(season);
    const detail = phase
      ? `${phase.name} <span style="color:#6b7280;font-weight:400;">through ${fmtSeasonDate(phase.endDate, tz)}</span>`
      : (season?.endDate ? `<span style="color:#6b7280;font-weight:400;">Season ends ${fmtSeasonDate(season.endDate, tz)}</span>` : '');
    return `
      <tr>
        <td style="${CELL}color:#111827;font-weight:700;white-space:nowrap;">${label}<span style="color:#6b7280;font-size:0.78rem;font-weight:400;">${season?.displayName ? ' · ' + season.displayName : ''}</span></td>
        <td align="right" style="${CELL}color:#4f46e5;font-weight:600;">${detail}
          <div style="color:#6b7280;font-size:0.78rem;font-weight:400;">${seasonStatusText(season)}</div>
        </td>
      </tr>`;
  }).join('');
  return `
    <div style="background:#eef2ff;border-radius:12px;padding:1rem 1.25rem;margin:0 0 1rem;">
      <h2 style="font-size:1.05rem;margin:0 0 0.5rem;color:#111827;">Season status</h2>
      ${TABLE_OPEN}${rows}</table>
    </div>`;
}

// This year's draft haul, one group per followed team that made picks. Covers
// out-of-season teams too — the draft is most of what there is to report in an
// offseason, which is exactly when this block earns its place.
function buildDraftBlock(draftTeams) {
  if (!draftTeams || draftTeams.length === 0) return '';
  const groups = draftTeams.map(({ name, year, picks }) => {
    const rows = picks.map((p) => `
      <tr>
        <td style="${CELL}color:#6b7280;white-space:nowrap;width:1%;padding-right:12px;">Rd ${p.round ?? '—'}</td>
        <td style="${CELL}color:#6b7280;white-space:nowrap;width:1%;padding-right:12px;">${p.overall ? '#' + p.overall : ''}</td>
        <td style="${CELL}color:#111827;font-weight:600;">${p.player}</td>
        <td align="right" style="${CELL}color:#4f46e5;font-weight:600;white-space:nowrap;">${p.position}</td>
      </tr>`).join('');
    return `
      <div style="margin:0 0 0.75rem;">
        <div style="color:#111827;font-weight:700;margin:0 0 0.15rem;">${name}
          <span style="color:#6b7280;font-size:0.78rem;font-weight:400;">${year ? ' · ' + year + ' draft' : ''}</span>
        </div>
        ${TABLE_OPEN}${rows}</table>
      </div>`;
  }).join('');
  return `
    <div style="background:#f5f3ff;border-radius:12px;padding:1rem 1.25rem;margin:0 0 1rem;">
      <h2 style="font-size:1.05rem;margin:0 0 0.6rem;color:#111827;">Draft picks</h2>
      ${groups}
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

function buildEmailHtml(teamDigests, tz, topics, seasons, offSeason, draftTeams) {
  const seasonBlock = topics.seasons ? buildSeasonBlock(seasons, tz) : '';
  const draftBlock = topics.draft ? buildDraftBlock(draftTeams) : '';
  const sections = teamDigests
    .map((t) => {
      const blocks = [];
      if (topics.standings && t.table) {
        blocks.push(`${sectionLabel('Standings', blocks.length === 0)}${standingsBlock(t.table, t.teamId)}`);
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

  // Wider than the usual 560px so the two standings tables sit side by side
  // without squeezing team names; the media query stacks them on phones in the
  // clients that support it (the rest just scale the whole email down).
  return `
    <style>
      @media only screen and (max-width:600px) {
        td.stack { display:block !important; width:100% !important; padding:0 0 12px !important; }
      }
    </style>
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:680px;margin:0 auto;padding:2rem;">
      <h1 style="font-size:1.5rem;color:#4f46e5;margin:0 0 0.25rem;">Rally Sports</h1>
      <p style="color:#525252;margin:0 0 1.25rem;">Your daily rundown 🏟️</p>
      ${seasonBlock}
      ${sections || (offSeason?.length ? '<p style="color:#6b7280;margin:0 0 1rem;">None of your leagues are in season right now.</p>' : '')}
      ${draftBlock}
      ${buildOffSeasonBlock(offSeason, tz)}
      <p style="color:#9ca3af;font-size:0.75rem;margin-top:1.5rem;">Scores &amp; schedules via ESPN. You're getting this because you set up a Sports digest in Rally.</p>
    </div>`;
}

// Assembles a user's digest and returns the finished email. Split out from the
// send so the Sports page can preview exactly what would arrive without one
// being sent — same config, same fetches, same HTML.
async function buildDigestForUser(userData) {
  const cfg = userData.sportsConfig || {};
  const email = cfg.email || userData.email;
  const teams = Array.isArray(cfg.teams) ? cfg.teams : [];
  if (!email) return { skipped: 'no email' };
  if (teams.length === 0) return { skipped: 'no teams' };

  const topics = normalizeTopics(cfg);
  if (!Object.values(topics).some(Boolean)) {
    return { skipped: 'no topics selected' };
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

  // Draft picks, one league fetch per league, covering every followed team —
  // including out-of-season ones, since an offseason is exactly when a team's
  // draft class is the news. Leagues ESPN has no draft for come back empty.
  let draftTeams = [];
  if (topics.draft) {
    const perLeague = await Promise.all(leagues.map(async (l) => {
      const leagueTeams = teams.filter((t) => t.sportPath === l.sportPath);
      const ids = leagueTeams.map((t) => t.teamId);
      const year = l.season?.year;
      if (!year) return [];
      // Leagues that span a new year name the season for the year it ends —
      // the NBA's 2026-27 season is year 2027, but the class that filled those
      // rosters is the 2026 draft. The NFL's season and draft share a year. Try
      // the season year, then the one before it, and label with whichever hit.
      let draftYear = year;
      let byTeam = await fetchDraftPicks(l.sportPath, draftYear, ids).catch(() => ({}));
      if (Object.keys(byTeam).length === 0) {
        draftYear = year - 1;
        byTeam = await fetchDraftPicks(l.sportPath, draftYear, ids).catch(() => ({}));
      }
      return leagueTeams
        .map((t) => ({ name: t.name, year: draftYear, picks: byTeam[String(t.teamId)] || [] }))
        .filter((t) => t.picks.length > 0);
    }));
    draftTeams = perLeague.flat();
  }

  const html = buildEmailHtml(digests, tz, topics, seasons, offSeason, draftTeams);
  const subject = inSeasonTeams.length
    ? `🏟️ Your Sports digest — ${inSeasonTeams.length} team${inSeasonTeams.length === 1 ? '' : 's'} in season`
    : '🏟️ Your Sports digest — all your leagues are out of season';
  return { html, subject, email, teams: teams.length };
}

async function sendDigestForUser(db, resendKey, uid, userData) {
  const built = await buildDigestForUser(userData);
  if (built.skipped) return { uid, skipped: built.skipped };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Rally Sports <noreply@resend.dev>',
      to: [built.email],
      subject: built.subject,
      html: built.html,
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return { uid, success: false, error: err.message || `HTTP ${response.status}` };
  }
  return { uid, success: true, teams: built.teams };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const resendKey = process.env.RESEND_API_KEY;

  let db;
  try {
    db = getFirestore();
  } catch {
    return res.status(200).json({ skipped: true, reason: 'Firebase Admin not configured.' });
  }

  // Preview — build the digest and hand back the HTML without sending anything.
  // Ahead of the RESEND_API_KEY check on purpose: previewing doesn't email, so
  // it shouldn't require the mail provider to be configured.
  if (req.method === 'POST' && req.body?.preview) {
    const uid = req.body?.uid;
    if (!uid) return res.status(400).json({ error: 'uid required' });
    try {
      const snap = await db.collection('users').doc(uid).get();
      if (!snap.exists) return res.status(404).json({ error: 'user not found' });
      const built = await buildDigestForUser(snap.data());
      if (built.skipped) return res.status(200).json({ skipped: built.skipped });
      return res.status(200).json({ html: built.html, subject: built.subject });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (!resendKey) {
    return res.status(200).json({ skipped: true, reason: 'No RESEND_API_KEY configured' });
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
