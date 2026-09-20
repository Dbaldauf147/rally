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
import { fetchKeyPlayers } from '../lib/espnPlayers.js';
import { senderAddress } from '../lib/emailSender.js';

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
const DEFAULT_TOPICS = { scores: true, upcoming: true, standings: true, players: true, seasons: true, draft: true };
function normalizeTopics(cfg) {
  const t = cfg?.topics;
  if (!t || typeof t !== 'object') return { ...DEFAULT_TOPICS };
  return {
    scores: t.scores !== false,
    upcoming: t.upcoming !== false,
    standings: t.standings !== false,
    players: t.players !== false,
    seasons: t.seasons !== false,
    draft: t.draft !== false,
  };
}

// ESPN labels the exhibition phase differently by league — "Preseason" in the
// NFL, NBA and NHL, "Spring Training" in MLB — so match the label rather than
// the wording of any one sport.
const PRESEASON_LABEL = /pre[-\s]?season|spring training|exhibition/i;

// Whether an event is an exhibition. The season-type NUMBER can't carry this on
// its own: type 1 is the exhibition phase in the US leagues but the REGULAR
// season in ESPN's soccer feeds, so keying off the number alone would drop
// every Premier League and MLS fixture. Go by the label ESPN ships on the
// event, and fall back to the number only where there's no label to read and
// the league is one that numbers its exhibitions 1.
function isPreseasonEvent(ev, sportPath) {
  const type = ev?.seasonType;
  if (!type) return false;
  const name = String(type.name || '');
  const abbrev = String(type.abbreviation || '');
  if (name || abbrev) return PRESEASON_LABEL.test(name) || /^pre$/i.test(abbrev);
  return !String(sportPath || '').startsWith('soccer/') && Number(type.type) === 1;
}

// Union of two event lists, keyed by ESPN's event id, so a game that comes back
// in both the default and the regular-season response is only listed once.
function mergeEvents(...lists) {
  const byId = new Map();
  for (const ev of lists.flat()) {
    const key = String(ev?.id ?? `${ev?.date}|${ev?.name}`);
    if (!byId.has(key)) byId.set(key, ev);
  }
  return [...byId.values()];
}

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
// dropping the exhibitions would just leave the section empty. The two
// responses are merged rather than swapped so a mixed list (the last exhibition
// alongside week 1) keeps its real games. If the regular season isn't published
// yet (the NBA in August), there's genuinely nothing to show and the team falls
// away, which is the right answer.
async function fetchTeamSchedule(team) {
  const scheduled = await fetchScheduleEvents(team);
  const isExhibition = (ev) => isPreseasonEvent(ev, team.sportPath);
  let events = scheduled.filter((ev) => !isExhibition(ev));
  if (scheduled.some(isExhibition)) {
    const regular = await fetchScheduleEvents(team, 2).catch(() => []);
    events = mergeEvents(events, regular.filter((ev) => !isExhibition(ev)));
  }
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
    .sort((a, b) => a.behind - b.behind || (b.pct || 0) - (a.pct || 0) || a.name.localeCompare(b.name))
    // Rank is fixed here, before any table is cut down, so a club shown below
    // a trimmed top ten still carries its real place.
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

const LEAGUE_TOP = 10;

/* The rows the whole-league table prints: the top ten, and the followed team
 * tacked on underneath when it sits below them — thirty rows to find one club
 * was the problem, but the club is still the reason you're reading the table.
 * Exported for tests. */
export function leagueTopRows(rows, teamId, limit = LEAGUE_TOP) {
  const top = (rows || []).slice(0, limit);
  const me = (rows || []).find((r) => r.id === String(teamId));
  return me && me.rank > limit ? [...top, me] : top;
}

// Where the team sits in the whole league, for the pill beside its name.
export function leagueRank(tables, teamId) {
  const rows = tables?.national?.rows || [];
  const me = rows.find((r) => r.id === String(teamId));
  return me ? { rank: me.rank, of: rows.length } : null;
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

/* Gather all requested content for one team, only fetching what's toggled on.
   `season` is the league's, and decides whether standings mean anything yet.

   Exhibition results are already kept out of the scores and upcoming sections
   (isPreseasonEvent) and out of the season status line, but ESPN's team and
   standings endpoints answer with whatever the current phase holds — so during
   the NFL preseason they return exhibition W-L, and the email printed 3-0
   records and a league table a week before any of it counted. Nothing was
   wrong with the numbers; they were just answers to a question nobody asked.
   Standings now follow the same rule the games sections do: skipped entirely
   until the phase that counts starts, with a line saying when that is. */
async function fetchTeamDigest(team, topics, standingsCache, season) {
  const out = { name: team.name, teamId: String(team.teamId), results: [], upcoming: [], record: '', standing: '', table: null, standingsFrom: null, keyPlayers: null };
  // Started alongside the schedule rather than after it; best-effort, so a
  // failure here costs the players block and nothing else.
  const players = topics.players ? fetchKeyPlayers(team, season).catch(() => null) : null;
  if (topics.scores || topics.upcoming) {
    const sched = await fetchTeamSchedule(team);
    out.results = sched.results;
    out.upcoming = sched.upcoming;
  }
  if (players) out.keyPlayers = await players;
  if (topics.standings) {
    out.standingsFrom = standingsHeldUntil(season);
    // Nothing to rank yet — skip the fetch as well as the block.
    if (out.standingsFrom) return out;
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
function standingsTable(table, teamId, rows = table.rows) {
  const body = rows.map((r, i) => {
    const me = r.id === teamId;
    // A row pulled up from below the cut gets a gap above it, so #17 doesn't
    // read as if it came straight after #10.
    const gap = i > 0 && r.rank !== rows[i - 1].rank + 1 ? 'border-top:2px dashed #e5e7eb;' : '';
    const base = `${CELL}${gap}${me ? 'background:#eef2ff;' : ''}font-weight:${me ? 700 : 400};`;
    const cell = `${base}color:${me ? '#111827' : '#4b5563'};`;
    return `
      <tr>
        <td width="18" align="right" style="${base}color:#9ca3af;">${r.rank ?? i + 1}</td>
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
      ${body}
    </table>`;
}

// Two blocks side by side. A table is the only side-by-side layout email
// clients agree on; the `stack` class lets the ones that honour media queries
// drop it back to a single column on narrow screens.
function twoColumn(left, right) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
      <tr>
        <td class="stack" width="50%" valign="top" style="padding-right:14px;">${left}</td>
        <td class="stack" width="50%" valign="top" style="padding-left:14px;">${right}</td>
      </tr>
    </table>`;
}

// Division on the left, the whole league on the right, so the team's place in
// its own race sits next to its place in the league.
function standingsBlock(tables, teamId) {
  const panels = [
    tables.division && { caption: tables.division.group, table: tables.division },
    tables.national && {
      caption: `${tables.national.group}${tables.national.rows.length > LEAGUE_TOP ? ` · top ${LEAGUE_TOP}` : ''}`,
      table: tables.national,
      rows: leagueTopRows(tables.national.rows, teamId),
    },
  ].filter(Boolean);
  const caption = (text) =>
    `<div style="font-size:0.72rem;font-weight:700;color:#374151;margin:0 0 4px;">${text}</div>`;
  const legend = `<div style="color:#9ca3af;font-size:0.7rem;margin-top:6px;">GB = games behind the leader of that table.</div>`;

  const panel = (p) => `${caption(p.caption)}${standingsTable(p.table, teamId, p.rows)}`;
  if (panels.length === 1) {
    return `${panel(panels[0])}${legend}`;
  }
  return `${twoColumn(panel(panels[0]), panel(panels[1]))}${legend}`;
}

// The five players who matter most and are available, one row each: headshot,
// name and position, then the number that put them on the list. Football and
// soccer pick by role, so the role rides under the name there.
function keyPlayersTable(players) {
  const rows = players.map((p) => {
    const face = p.headshot
      ? `<img src="${p.headshot}" alt="" width="28" height="28" style="width:28px;height:28px;border-radius:50%;object-fit:cover;background:#e5e7eb;border:0;vertical-align:middle;" />`
      : '';
    return `
      <tr>
        <td width="34" valign="middle" style="${CELL}">${face}</td>
        <td valign="middle" style="${CELL}color:#111827;font-weight:600;">${p.name}
          <span style="color:#6b7280;font-weight:400;font-size:0.78rem;">${p.position ? ' · ' + p.position : ''}</span>
          ${p.role ? `<div style="color:#9ca3af;font-size:0.72rem;font-weight:400;">${p.role}</div>` : ''}
        </td>
        <td align="right" valign="middle" style="${CELL}color:#4f46e5;font-weight:600;padding-left:10px;">${p.stat}</td>
      </tr>`;
  }).join('');
  return `${TABLE_OPEN}${rows}</table>`;
}

const sectionLabel = (text, first) =>
  `<div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:${first ? '0' : '0.9rem'} 0 0.3rem;">${text}</div>`;

// The phase covering right now, if ESPN has one for this moment.
function currentPhase(season) {
  const now = Date.now();
  return (season?.phases || []).find((p) =>
    now >= new Date(p.startDate).getTime() && now <= new Date(p.endDate).getTime()) || null;
}

const isPreseasonPhase = (phase) => PRESEASON_LABEL.test(phase?.name || '');
const isOffSeasonPhase = (phase) => /off\s*-?\s*season/i.test(phase?.name || '');

/* Whether standings should be withheld, and what they're waiting for.
 *
 * Returns the phase to wait for while a league is playing exhibitions, or null
 * once its results count. Exported for tests: this is the whole reason a
 * preseason 3-0 used to reach the email as though it were the standings.
 */
export function standingsHeldUntil(season) {
  const phase = currentPhase(season);
  if (!phase || !isPreseasonPhase(phase)) return null;
  // ESPN occasionally has no upcoming counting phase to name, which still
  // shouldn't resurrect the exhibition table — hence the unnamed fallback.
  return nextCountingPhase(season) || { name: 'The regular season', startDate: null };
}

const isDraftPhase = (phase) => /draft/i.test(phase?.name || '');

/* When this league's season proper begins.
 *
 * The first phase that plays games that count — the regular season, in every
 * league here. Exhibitions don't open a season and neither does the draft,
 * which ESPN hands back merged into the phase list and sorted by date, so it
 * sits ahead of the regular season and would otherwise be picked as the start.
 *
 * Leagues ESPN has no phases for fall back to the season window itself, which
 * is the only start date there is for them.
 */
function seasonOpener(season) {
  const counting = (season?.phases || []).find((p) =>
    p?.startDate && !isPreseasonPhase(p) && !isOffSeasonPhase(p) && !isDraftPhase(p));
  if (counting) return counting;
  return season?.startDate ? { name: 'Season', startDate: season.startDate } : null;
}

// How far back a digest has to look to be sure it mentions an opener at all.
// A weekly reader who only ever sees Sundays would miss a Thursday kickoff
// announced with a one-day memory, so the window is the send cadence plus a
// day of slack.
const OPENER_LOOKBACK_DAYS = { daily: 2, weekly: 8, monthly: 31 };

/* Leagues whose season is about to start, or just has.
 *
 * The banner this feeds is the one thing in the email that should interrupt
 * you: everything else is a status you scan, and a season opening is a date
 * you act on. So it appears in a window around the start rather than for the
 * whole run-up — a countdown that shows every week for two months stops being
 * news long before the season does.
 *
 * Exported for tests, which is also the honest way to check a banner that
 * depends on what day it is.
 */
export function seasonOpeners(leagues, { now = Date.now(), lookaheadDays = 7, lookbackDays = 8 } = {}) {
  const out = [];
  for (const { label, season } of leagues || []) {
    const opener = seasonOpener(season);
    const at = opener ? new Date(opener.startDate).getTime() : NaN;
    if (!Number.isFinite(at)) continue;
    const days = Math.round((at - now) / 86400000);
    if (days > lookaheadDays || days < -lookbackDays) continue;
    out.push({ label, name: opener.name, startDate: opener.startDate, days, started: at <= now });
  }
  return out.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
}

// The next phase that plays games that count, for a league ESPN currently has
// in its exhibition window. Phases arrive sorted by start date, so the first
// future one that's neither an exhibition nor the offseason is what the league
// is actually counting down to — the regular season, in every league here.
function nextCountingPhase(season) {
  const now = Date.now();
  return (season?.phases || []).find((p) =>
    new Date(p.startDate).getTime() > now && !isPreseasonPhase(p) && !isOffSeasonPhase(p)) || null;
}

/* The banner: a league's season is starting, or just did.
 *
 * Sits above everything, in the one colour the rest of the email doesn't use,
 * because it is the only part that is news rather than status. Kept to a line
 * per league — the detail is in the Season status block right underneath, and
 * a banner that repeats it is just a taller banner.
 */
export function buildSeasonBanner(openers, tz) {
  if (!openers || openers.length === 0) return '';
  const rows = openers.map((o) => {
    const date = fmtSeasonDate(o.startDate, tz);
    const when = o.started
      ? (o.days === 0 ? 'started today' : `started ${date}`)
      : (o.days === 0 ? 'starts today' : o.days === 1 ? 'starts tomorrow' : `starts ${date}`);
    return `
      <tr>
        <td style="padding:3px 0;color:#78350f;font-weight:700;white-space:nowrap;padding-right:12px;">${o.label}</td>
        <td style="padding:3px 0;color:#92400e;">${o.name} <span style="font-weight:600;">${when}</span></td>
      </tr>`;
  }).join('');
  const heading = openers.length === 1
    ? (openers[0].started ? 'A new season has started' : 'A new season starts')
    : 'New seasons';
  return `
    <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:12px;padding:0.9rem 1.25rem;margin:0 0 1rem;">
      <h2 style="font-size:1.05rem;margin:0 0 0.4rem;color:#78350f;">🏁 ${heading}</h2>
      ${TABLE_OPEN.replace('font-size:0.85rem;', 'font-size:0.9rem;')}${rows}</table>
    </div>`;
}

/* Where each followed league sits in the year — the season status as a chart.
 *
 * A list of end dates answers "how long has this one got left" one league at a
 * time and never answers the question you actually had, which is what the year
 * looks like: which sports overlap, where the gaps are, and how far into all of
 * it today is. So the block is a twelve-month track with a bar per league, and
 * the dates stay beside it for the reader who wants the exact day.
 *
 * The window starts two months before this one rather than in January, because
 * a calendar year cuts every autumn league in half — the NFL's regular season
 * runs into the next January and would have nowhere to go. Two months of
 * hindsight puts today near the left edge and gives the rest of the width to
 * the part of the year that hasn't happened yet.
 */
const TIMELINE_MONTHS = 12;
const TIMELINE_LEAD_MONTHS = 2;
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const POSTSEASON_LABEL = /post[-\s]?season|playoff|finals|world series|stanley cup|championship/i;

/* How a phase is drawn, or null for one that isn't.
 *
 * The draft is a single day, which at a year's width is thinner than the line
 * it would be drawn with — it stays in the banner and the draft block, where
 * it has room to be read.
 */
function phaseKind(name) {
  const phase = { name: name || '' };
  if (isDraftPhase(phase)) return null;
  if (isOffSeasonPhase(phase)) return 'off';
  if (isPreseasonPhase(phase)) return 'pre';
  if (POSTSEASON_LABEL.test(phase.name)) return 'post';
  return 'regular';
}

// Each kind in two tones: the one it's drawn in ahead of today, and a faded one
// behind, so a bar shows how much of itself has already been played without
// needing a second row to say so.
const PHASE_TONE = {
  off: { ahead: '#c9ced7', behind: '#d5d9e0', label: 'Between seasons' },
  pre: { ahead: '#c7d2fe', behind: '#e0e7ff', label: 'Preseason' },
  regular: { ahead: '#4f46e5', behind: '#a5b4fc', label: 'Regular season' },
  post: { ahead: '#312e81', behind: '#818cf8', label: 'Postseason' },
};

// The empty track either side of a season, in the same before/after pair. The
// step between the two runs down every row at today's position, which is what
// makes "we are here" readable across leagues without drawing a line over the
// bars — email clients have no reliable way to lay one on top.
const GAP_TONE = { behind: '#e2e5ea', ahead: '#f3f4f6' };

// The twelve months the track covers, each as wide as it really is. Equal
// twelfths would drift a bar up to three days away from the month label above
// it, which is exactly the misreading a chart like this exists to prevent.
function monthTicks(start, end) {
  const span = end - start;
  const out = [];
  let year = new Date(start).getUTCFullYear();
  let month = new Date(start).getUTCMonth();
  for (;;) {
    const from = Date.UTC(year, month, 1);
    if (from >= end) break;
    const to = Math.min(Date.UTC(year, month + 1, 1), end);
    out.push({ label: MONTH_LABELS[month], year, month, width: ((to - from) / span) * 100 });
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return out;
}

/* The chart as numbers: a window, a position for today, and one row of
 * percentage spans per league.
 *
 * Every league asked for comes back, including any whose season falls entirely
 * outside the window — that row renders as an empty track rather than
 * disappearing, because a league silently missing from the chart reads as a
 * league you no longer follow. Exported for tests, which is the only way to
 * check a layout whose whole job is arithmetic.
 */
export function seasonYearSpans(leagues, { now = Date.now() } = {}) {
  const today = new Date(now);
  const first = today.getUTCMonth() - TIMELINE_LEAD_MONTHS;
  const start = Date.UTC(today.getUTCFullYear(), first, 1);
  const end = Date.UTC(today.getUTCFullYear(), first + TIMELINE_MONTHS, 1);
  const span = end - start;
  const pct = (t) => Math.max(0, Math.min(100, ((t - start) / span) * 100));

  const rows = (leagues || []).map(({ label, season }) => {
    // Leagues ESPN has no phase breakdown for still have a season window, drawn
    // as one undifferentiated regular season — the only honest reading of the
    // single pair of dates there is.
    const source = (season?.phases || []).length
      ? season.phases.map((p) => ({ kind: phaseKind(p.name), from: Date.parse(p.startDate), to: Date.parse(p.endDate) }))
      : [{ kind: 'regular', from: Date.parse(season?.startDate), to: Date.parse(season?.endDate) }];

    const clamped = [];
    for (const s of source) {
      if (!s.kind || !Number.isFinite(s.from) || !Number.isFinite(s.to) || s.to <= s.from) continue;
      // An off season is normally the gap between the bars, so drawing it would
      // double the ink and say nothing. The exception is the one a league is
      // sitting in right now: without it a dark league gets an empty track,
      // which reads as a league nobody has any dates for rather than one whose
      // year hasn't come round yet. Drawn, the bar ends on the day it returns.
      if (s.kind === 'off' && !(s.from <= now && now < s.to)) continue;
      const from = Math.max(s.from, start);
      const to = Math.min(s.to, end);
      if (to > from) clamped.push({ kind: s.kind, from, to });
    }
    clamped.sort((a, b) => a.from - b.from);

    const segments = [];
    let filled = start;
    for (const s of clamped) {
      // ESPN occasionally hands back phases that overlap by a day. Trimming the
      // later one keeps a row's widths adding up to the track.
      const from = Math.max(s.from, filled);
      if (s.to <= from) continue;
      filled = s.to;
      // Split at today so the part already played can be drawn faded.
      const cuts = from < now && now < s.to ? [[from, now], [now, s.to]] : [[from, s.to]];
      for (const [a, b] of cuts) {
        segments.push({ kind: s.kind, behind: b <= now, start: pct(a), end: pct(b) });
      }
    }
    return { label, segments };
  });

  // Read as a cascade: leagues ordered by when they start playing, so the chart
  // runs top-left to bottom-right instead of in whatever order the teams were
  // added. Leagues with no games in the window at all — a dark one, or one ESPN
  // has no dates for — fall to the bottom, since they have no place in the
  // cascade and the top of the chart belongs to the sport that's on.
  const opensAt = (row) => row.segments.find((s) => s.kind !== 'off')?.start ?? 101;
  rows.sort((a, b) => opensAt(a) - opensAt(b) || a.label.localeCompare(b.label));
  return { start, end, nowPct: pct(now), months: monthTicks(start, end), rows };
}

const BAR_TABLE = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;table-layout:fixed;">';

// Bars are empty cells with a background, so they need a height and something
// inside them to stop Outlook collapsing the row to nothing.
const barCell = (width, bg) =>
  `<td width="${width.toFixed(3)}%" style="width:${width.toFixed(3)}%;height:12px;line-height:12px;font-size:0;background:${bg};">&nbsp;</td>`;

// One league's track: its phases in order, with the empty stretches either side
// drawn too, split at today so the whole row carries the before/after step.
function timelineBar(segments, nowPct) {
  const cells = [];
  const gap = (from, to) => {
    if (to - from < 0.01) return;
    if (from < nowPct && nowPct < to) {
      cells.push(barCell(nowPct - from, GAP_TONE.behind));
      cells.push(barCell(to - nowPct, GAP_TONE.ahead));
    } else {
      cells.push(barCell(to - from, to <= nowPct ? GAP_TONE.behind : GAP_TONE.ahead));
    }
  };
  let cursor = 0;
  for (const s of segments) {
    gap(cursor, s.start);
    cells.push(barCell(s.end - s.start, PHASE_TONE[s.kind][s.behind ? 'behind' : 'ahead']));
    cursor = s.end;
  }
  gap(cursor, 100);
  return `${BAR_TABLE}<tr>${cells.join('')}</tr></table>`;
}

// The month scale over the track. January carries its year, since the window
// crosses one and a bare "Jan" is the one label that could mean either side.
function timelineMonths(months) {
  const cells = months.map((m) => {
    const turn = m.month === 0;
    const year = turn ? `&nbsp;&rsquo;${String(m.year).slice(2)}` : '';
    return `<td width="${m.width.toFixed(3)}%" style="width:${m.width.toFixed(3)}%;font-size:0.58rem;letter-spacing:0.03em;color:${turn ? '#4b5563' : '#9ca3af'};font-weight:${turn ? 700 : 600};padding:0 0 3px 3px;border-left:1px solid ${turn ? '#c7cbd3' : '#e5e7eb'};white-space:nowrap;">${m.label}${year}</td>`;
  }).join('');
  return `${BAR_TABLE}<tr>${cells}</tr></table>`;
}

// Today, called out over the track. The label sits to the right of its own
// position until that would push it off the end, at which point it flips and
// points back — the caret stays on the date either way.
function timelineToday(nowPct) {
  const left = nowPct <= 55;
  const pad = (left ? nowPct : 100 - nowPct).toFixed(3);
  const spacer = `<td width="${pad}%" style="width:${pad}%;font-size:0;line-height:0;">&nbsp;</td>`;
  const label = `<td align="${left ? 'left' : 'right'}" style="white-space:nowrap;font-size:0.58rem;line-height:1;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#111827;padding:0 0 2px;">${left ? '&#9660; Today' : 'Today &#9660;'}</td>`;
  return `${BAR_TABLE}<tr>${left ? spacer + label : label + spacer}</tr></table>`;
}

const legendSwatch = (bg, text) =>
  `<span style="white-space:nowrap;margin-right:10px;"><span style="display:inline-block;width:9px;height:9px;background:${bg};vertical-align:middle;">&nbsp;</span> <span style="color:#6b7280;">${text}</span></span>`;

/* Where a season stands in words, for the columns either side of the bar.
 *
 * Unchanged for a league that's playing: the phase and the day it runs to, with
 * the days left beside it. Out-of-season leagues are in the chart now as well,
 * so there's a third answer — when the league comes back — that the old
 * in-season-only block never had to give.
 */
function seasonStatusParts(season, tz) {
  const phase = currentPhase(season);
  // Exhibitions are left out of the games sections, so the status line doesn't
  // announce them either — a league sitting in its preseason counts down to
  // the phase that does play games instead.
  const counting = phase && isPreseasonPhase(phase) ? nextCountingPhase(season) : null;
  let status = seasonStatusText(season).replace(/^In season · /, '');
  let detail;
  if (counting) {
    detail = `${counting.name} starts ${fmtSeasonDate(counting.startDate, tz)}`;
    status = `in ${daysUntil(counting.startDate)} days`;
  } else if (phase && !isPreseasonPhase(phase) && !isOffSeasonPhase(phase)) {
    detail = `${phase.name} through ${fmtSeasonDate(phase.endDate, tz)}`;
  } else {
    const next = nextSeasonStart(season);
    if (next) {
      detail = `Season starts ${fmtSeasonDate(next, tz)}`;
      status = `in ${daysUntil(next)} days`;
    } else {
      detail = season?.endDate ? `Season ends ${fmtSeasonDate(season.endDate, tz)}` : '';
    }
  }
  return { detail, status };
}

/* The season block: a year of sport as a chart, with the dates alongside.
 *
 * Takes every followed league, in season or not, because "what's happening
 * when" is a question about the year and not about today — an empty winter is
 * as much a part of the answer as a full autumn. The full phase-by-phase
 * calendar stays on the Sports page; this still only answers what part of the
 * season each league is in and how much of it is left. Exported for tests.
 */
export function buildSeasonBlock(leagues, tz, now = Date.now()) {
  if (!leagues || leagues.length === 0) return '';
  const chart = seasonYearSpans(leagues, { now });
  const seasonByLabel = new Map(leagues.map((l) => [l.label, l.season]));
  const rows = chart.rows.map(({ label, segments }) => {
    const { detail, status } = seasonStatusParts(seasonByLabel.get(label), tz);
    const cell = 'padding:4px 0;vertical-align:middle;';
    return `
      <tr>
        <td width="124" style="${cell}width:124px;padding-right:10px;">
          <div style="color:#111827;font-weight:700;font-size:0.85rem;line-height:1.2;">${label}</div>
          <div style="color:#9ca3af;font-size:0.68rem;line-height:1.3;">${detail}</div>
        </td>
        <td style="${cell}">${timelineBar(segments, chart.nowPct)}</td>
        <td align="right" width="96" style="${cell}width:96px;padding-left:10px;color:#4f46e5;font-weight:600;font-size:0.78rem;white-space:nowrap;">${status}</td>
      </tr>`;
  }).join('');
  const edge = (m) => `${MONTH_LABELS[m.month]} ${m.year}`;
  const range = `${edge(chart.months[0])} – ${edge(chart.months[chart.months.length - 1])}`;
  // Only the tones actually on the chart get a key. "Between seasons" in
  // particular is there for the reader looking at a grey bar and wondering
  // what it means, so in a week when nothing is dark it has nothing to explain.
  const drawn = new Set(chart.rows.flatMap((r) => r.segments.map((s) => s.kind)));
  const keys = ['off', 'pre', 'regular', 'post'].filter((k) => drawn.has(k));
  return `
    <div style="background:#eef2ff;border-radius:10px;padding:0.7rem 1rem 0.6rem;margin:0 0 1rem;">
      <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;font-weight:600;margin:0 0 4px;">Season status<span style="color:#9ca3af;font-weight:500;"> · ${range}</span></div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
        <tr>
          <td width="124" style="width:124px;padding-right:10px;"></td>
          <td>${timelineToday(chart.nowPct)}${timelineMonths(chart.months)}</td>
          <td width="96" style="width:96px;padding-left:10px;"></td>
        </tr>
        ${rows}
      </table>
      <div style="font-size:0.62rem;margin:8px 0 0;">
        ${keys.map((k) => legendSwatch(PHASE_TONE[k].ahead, PHASE_TONE[k].label)).join('')}<span style="color:#9ca3af;white-space:nowrap;">Faded = already played</span>
      </div>
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

function buildEmailHtml(teamDigests, tz, topics, seasons, offSeason, draftTeams, openers) {
  // The banner rides with the season calendars: both answer "where is this
  // league in its year", so turning that topic off turns off both.
  const bannerBlock = topics.seasons ? buildSeasonBanner(openers, tz) : '';
  // Both lists, because the chart is a picture of the year rather than of
  // today: a league that's dark until March is exactly what explains the empty
  // stretch of track beside it.
  const seasonBlock = topics.seasons ? buildSeasonBlock([...seasons, ...offSeason], tz) : '';
  const draftBlock = topics.draft ? buildDraftBlock(draftTeams) : '';
  const sections = teamDigests
    .map((t) => {
      const blocks = [];
      if (topics.standings && t.standingsFrom) {
        // In the exhibition window: say when the table starts meaning something
        // rather than printing preseason W-L as though it were the standings.
        const when = t.standingsFrom.startDate
          ? `starts ${fmtSeasonDate(t.standingsFrom.startDate, tz)}`
          : 'hasn’t started yet';
        blocks.push(`${sectionLabel('Standings', blocks.length === 0)}<div style="color:#9ca3af;">${t.standingsFrom.name} ${when}.</div>`);
      } else if (topics.standings && t.table) {
        blocks.push(`${sectionLabel('Standings', blocks.length === 0)}${standingsBlock(t.table, t.teamId)}`);
      } else if (topics.standings && (t.record || t.standing)) {
        const parts = [t.record, t.standing].filter(Boolean).join(' · ');
        blocks.push(`${sectionLabel('Record &amp; standing', blocks.length === 0)}<div style="margin:2px 0;color:#1f2937;font-weight:600;">${parts}</div>`);
      }
      if (topics.players && t.keyPlayers?.players?.length) {
        const note = t.keyPlayers.lastSeason
          ? ` <span style="text-transform:none;letter-spacing:0;color:#9ca3af;">· ${t.keyPlayers.year} stats</span>`
          : '';
        blocks.push(`${sectionLabel(`Key players${note}`, blocks.length === 0)}${keyPlayersTable(t.keyPlayers.players)}`);
      }
      // Scores and schedule are both narrow lists, so they ride side by side —
      // that's most of the width buying back height. Either one alone spans the
      // block, and phones stack them again.
      const first = blocks.length === 0;
      const scores = topics.scores && `${sectionLabel('Recent scores', first)}${t.results.length
        ? resultsTable(t.results, tz)
        : '<div style="color:#9ca3af;">No games in the last few days.</div>'}`;
      const upcoming = topics.upcoming && `${sectionLabel('Upcoming', first)}${t.upcoming.length
        ? upcomingTable(t.upcoming, tz)
        : '<div style="color:#9ca3af;">No upcoming games scheduled.</div>'}`;
      if (scores && upcoming) blocks.push(twoColumn(scores, upcoming));
      else if (scores || upcoming) blocks.push(scores || upcoming);
      // Place in the whole league, beside the name. Only when standings are on
      // and counting — the preseason line above says why there isn't one.
      const place = topics.standings && !t.standingsFrom ? leagueRank(t.table, t.teamId) : null;
      const rankPill = place
        ? ` <span style="display:inline-block;background:#4f46e5;color:#fff;border-radius:999px;padding:1px 8px;font-size:0.8rem;font-weight:700;vertical-align:middle;">#${place.rank}</span><span style="color:#9ca3af;font-size:0.75rem;font-weight:400;vertical-align:middle;"> of ${place.of}</span>`
        : '';
      return `
        <div style="background:#f5f3ef;border-radius:12px;padding:1rem 1.25rem;margin:0 0 1rem;">
          <h2 style="font-size:1.05rem;margin:0 0 0.5rem;color:#111827;">${t.name}${rankPill}</h2>
          ${blocks.join('')}
        </div>`;
    })
    .join('');

  // Wide enough to run two tables side by side — standings next to standings,
  // scores next to the schedule — which is what keeps the digest from scrolling
  // on forever. The media query stacks the pairs on phones in the clients that
  // support it (the rest just scale the whole email down).
  return `
    <style>
      @media only screen and (max-width:700px) {
        td.stack { display:block !important; width:100% !important; padding:0 0 12px !important; }
      }
    </style>
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:900px;margin:0 auto;padding:2rem;">
      <h1 style="font-size:1.5rem;color:#4f46e5;margin:0 0 0.25rem;">Rally Sports</h1>
      <p style="color:#525252;margin:0 0 1.25rem;">Your daily rundown 🏟️</p>
      ${bannerBlock}
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
  const seasonByPath = new Map(leagues.map((l) => [l.sportPath, l.season]));
  const digests = [];
  for (const team of inSeasonTeams) {
    try {
      digests.push(await fetchTeamDigest(team, topics, standingsCache, seasonByPath.get(team.sportPath)));
    } catch (err) {
      digests.push({ name: team.name, teamId: String(team.teamId), results: [], upcoming: [], record: '', standing: '', table: null, standingsFrom: null, error: err.message });
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

  // Openers are read off every followed league, not just the in-season ones:
  // a league whose regular season starts on Thursday is still out of season
  // today, which is exactly when the banner has something to say.
  const openers = seasonOpeners(leagues, {
    lookbackDays: OPENER_LOOKBACK_DAYS[cfg.frequency || 'daily'] ?? 8,
  });

  const html = buildEmailHtml(digests, tz, topics, seasons, offSeason, draftTeams, openers);
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
      from: senderAddress('Rally Sports'),
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
