// A followed team's highlights for a stretch of days, played back to back — the
// one link per team in the Sports digest. GET ?team=baseball/mlb:10&from=ms&to=ms
//
// Public on purpose: the link is opened from an email, often on a phone where
// nobody is signed in, and all it shows is ESPN's own public clips. It reads
// only the highlight store (lib/sportsHighlightStore.js), which the digest cron
// fills daily while ESPN still has each game's video.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { storedTeamHighlights } from '../lib/sportsHighlightStore.js';
import { fmtClipLength } from '../lib/espnHighlights.js';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) initializeApp({ credential: cert(sa) });
}

const DAY = 86400000;
const MAX_WINDOW = 35 * DAY;
const TEAM_KEY = /^[a-z0-9-]+\/[a-z0-9.-]+:\d+$/;

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only ever ESPN's own hosts in an href or src, whatever got stored.
const safeUrl = (u) => (/^https:\/\/([a-z0-9-]+\.)*(espn\.com|espncdn\.com|akamaized\.net|dssott\.com)\//i.test(String(u || '')) ? u : '');

export function parseReelQuery(query, now = Date.now()) {
  const team = String(query?.team || '');
  if (!TEAM_KEY.test(team)) return null;
  let to = Number(query?.to) || now;
  let from = Number(query?.from) || to - 7 * DAY;
  if (to > now) to = now;
  if (from > to) from = to - 7 * DAY;
  if (to - from > MAX_WINDOW) from = to - MAX_WINDOW;
  return { team, from, to };
}

// The name as ESPN spells it on the stored games, since the link carries only an id.
export function teamNameFrom(games, key) {
  const id = key.split(':')[1];
  for (const g of games) {
    const c = (g.competitors || []).find((x) => String(x.id) === id);
    if (c?.name) return c.name;
  }
  return 'Your team';
}

// "NYY 5 · BAL 3", winner first-class via bold, away side first.
function scoreLine(g) {
  const away = g.competitors?.find((c) => !c.home) || g.competitors?.[0];
  const home = g.competitors?.find((c) => c.home) || g.competitors?.[1];
  const side = (c) => (c ? `<span class="${c.winner ? 'win' : ''}">${escapeHtml(c.abbrev || c.name)} ${escapeHtml(c.score)}</span>` : '');
  return `${side(away)} <span class="at">@</span> ${side(home)}`;
}

/* The page: one player that works through every clip in game order, and the
 * games listed underneath so any of them can be jumped to. A clip ESPN gave us
 * no file for opens on ESPN instead of playing here. Exported for tests. */
export function renderReelPage({ teamName, games }) {
  const clips = [];
  const rows = games.map((g) => {
    const items = g.clips.map((c) => {
      const src = safeUrl(c.src);
      const href = safeUrl(c.href);
      const i = src ? clips.push({ src, poster: safeUrl(c.poster), title: c.kind === 'reel' ? 'Game highlights' : c.title, game: g.eventId }) - 1 : -1;
      const label = escapeHtml(c.kind === 'reel' ? 'Game highlights' : c.title);
      const len = `<span class="len">${fmtClipLength(c.duration)}</span>`;
      return i >= 0
        ? `<li><button type="button" data-i="${i}">${label}</button> ${len}</li>`
        : `<li><a href="${escapeHtml(href)}" target="_blank" rel="noopener">${label} ↗</a> ${len}</li>`;
    }).join('');
    return `<section class="game" data-game="${escapeHtml(g.eventId)}">
      <div class="head"><time data-iso="${escapeHtml(g.iso)}"></time><span class="score">${scoreLine(g)}</span></div>
      <ul>${items}</ul>
    </section>`;
  }).join('');
  const total = games.reduce((n, g) => n + g.clips.reduce((m, c) => m + (c.duration || 0), 0), 0);
  const title = `${escapeHtml(teamName)} highlights`;
  const empty = '<p class="empty">No highlights saved for these days yet. ESPN posts most reels within a few hours of the final.</p>';

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  :root { --bg:#faf9f7; --card:#fff; --ink:#111827; --muted:#6b7280; --line:#e5e7eb; --accent:#4f46e5; --on:#eef2ff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111113; --card:#1c1c20; --ink:#f3f4f6; --muted:#9ca3af; --line:#2e2e34; --accent:#a5b4fc; --on:#26264a; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  main { max-width:760px; margin:0 auto; padding:20px 16px 40px; }
  h1 { font-size:1.35rem; margin:0 0 2px; }
  .sub { color:var(--muted); margin:0 0 14px; font-size:0.85rem; }
  video { width:100%; aspect-ratio:16/9; background:#000; border-radius:10px; display:block; }
  .now { display:flex; justify-content:space-between; gap:12px; align-items:center; margin:8px 0 18px; font-size:0.85rem; color:var(--muted); }
  .now b { color:var(--ink); font-weight:600; }
  .now button { font:inherit; border:1px solid var(--line); background:var(--card); color:var(--ink); border-radius:999px; padding:3px 12px; cursor:pointer; white-space:nowrap; }
  .game { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 12px; margin:0 0 8px; }
  .game.on { border-color:var(--accent); }
  .head { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
  time { color:var(--muted); font-size:0.78rem; min-width:78px; }
  .score .win { font-weight:700; } .score .at { color:var(--muted); }
  ul { list-style:none; margin:4px 0 0; padding:0; }
  li { font-size:0.85rem; padding:2px 0; }
  li button, li a { font:inherit; background:none; border:0; padding:0; color:var(--accent); cursor:pointer; text-align:left; text-decoration:none; font-weight:600; }
  li button.on { text-decoration:underline; }
  .len { color:var(--muted); }
  .empty { color:var(--muted); }
  footer { color:var(--muted); font-size:0.75rem; margin-top:18px; }
</style>
</head><body><main>
  <h1>${title}</h1>
  <p class="sub">${games.length} game${games.length === 1 ? '' : 's'} · ${fmtClipLength(total)} of video, each game under two minutes</p>
  ${clips.length ? `<video id="v" controls playsinline preload="metadata"></video>
  <div class="now"><span id="now"></span><button type="button" id="next">Next ›</button></div>` : ''}
  ${games.length ? rows : empty}
  <footer>Video via ESPN. From your Rally Sports digest.</footer>
</main>
<script>
  const clips = ${JSON.stringify(clips).replace(/</g, '\\u003c')};
  for (const t of document.querySelectorAll('time[data-iso]')) {
    const d = new Date(t.dataset.iso);
    if (!isNaN(d)) t.textContent = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  const v = document.getElementById('v');
  if (v && clips.length) {
    let cur = 0;
    const load = (i, play) => {
      cur = i;
      const c = clips[i];
      v.src = c.src;
      if (c.poster) v.poster = c.poster; else v.removeAttribute('poster');
      document.getElementById('now').innerHTML = '';
      const b = document.createElement('b'); b.textContent = c.title;
      document.getElementById('now').append(b, ' · ' + (i + 1) + ' of ' + clips.length);
      document.getElementById('next').hidden = i >= clips.length - 1;
      for (const el of document.querySelectorAll('li button')) el.classList.toggle('on', Number(el.dataset.i) === i);
      for (const el of document.querySelectorAll('.game')) el.classList.toggle('on', el.dataset.game === c.game);
      if (play) v.play().catch(() => {});
    };
    v.addEventListener('ended', () => { if (cur < clips.length - 1) load(cur + 1, true); });
    document.getElementById('next').addEventListener('click', () => load(cur + 1, true));
    document.addEventListener('click', (e) => {
      const b = e.target.closest('li button');
      if (b) { load(Number(b.dataset.i), true); v.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    });
    load(0, false);
  }
</script>
</body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const q = parseReelQuery(req.query);
  if (!q) return res.status(400).send('Unknown team.');
  let games;
  try {
    games = await storedTeamHighlights(getFirestore(), q.team, q.from, q.to);
  } catch (err) {
    return res.status(500).send(`Couldn't load highlights: ${escapeHtml(err.message)}`);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).send(renderReelPage({ teamName: teamNameFrom(games, q.team), games }));
}
