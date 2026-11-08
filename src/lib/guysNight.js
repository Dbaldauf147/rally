// Guys Night Out on a Rally event — the steakhouse list from Prep Day.
//
// The list itself lives in Prep Day (a separate Firebase project): each
// Eating Out spot can carry guysNightDone / guysNightSkip / guysNightDates.
// The rules for which spots are steakhouses and how they split are MIRRORED
// from Prep Day's src/utils/guysNight.ts and the website's
// src/utils/guysNight.js — keep them identical, or Rally's card and the Guys
// Night tab will disagree about what's left.
//
// Pure: no Firestore, no network. Shared by the event card (via the API's
// answer), the endpoint that reads Prep Day, and the email.

// The steak-night event: a title saying "steak" shows the list unless the
// organizer switched it off; `steakhouseList: true` shows it on any title.
export function steakhouseListOn(event) {
  if (!event) return false;
  if (event.steakhouseList === true) return true;
  if (event.steakhouseList === false) return false;
  return /\bsteak/i.test(String(event.title || ''));
}

// Mirrors spotCategories: `cuisines` is the one tag list now, the legacy
// `categories` is still read for older rows.
function spotCategories(r) {
  const out = [];
  const seen = new Set();
  for (const list of [r?.cuisines, r?.categories]) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const v = typeof raw === 'string' ? raw.trim() : '';
      if (!v || seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}

export const isSteakhouse = (r) => spotCategories(r).some((c) => /steak/i.test(c));

export function guysNightState(r) {
  if (r?.guysNightDone) return 'done';
  if (r?.guysNightSkip) return 'skip';
  return 'todo';
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The days a spot was done for guys night: valid YYYY-MM-DD, deduped, newest first. */
export function guysNightDates(r) {
  const list = Array.isArray(r?.guysNightDates) ? r.guysNightDates : [];
  return [...new Set(list.filter((d) => typeof d === 'string' && DAY_RE.test(d)))].sort().reverse();
}

/** "Dec 22, 2025" for a YYYY-MM-DD, read as a calendar day (no timezone shift). */
export function formatGuysNightDate(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
const wantFirst = (r) => (r.status === 'want-to-try' && !r.lastVisit ? 0 : 1);

/** Mirrors guysNightSections: todo (★ Next, then never-been, then A–Z), done (latest visit first), skip. */
export function guysNightSections(items) {
  const todo = [];
  const done = [];
  const skip = [];
  const seen = new Set();
  for (const r of items || []) {
    if (!r) continue;
    const key = `${r._ownerUid || ''}:${r.id}`;
    if (seen.has(key)) continue;
    const state = guysNightState(r);
    if (state === 'todo' && !isSteakhouse(r)) continue;
    seen.add(key);
    (state === 'done' ? done : state === 'skip' ? skip : todo).push(r);
  }
  todo.sort((a, b) => (b.nextSpot ? 1 : 0) - (a.nextSpot ? 1 : 0) || wantFirst(a) - wantFirst(b) || byName(a, b));
  const latest = (r) => guysNightDates(r)[0] || '';
  done.sort((a, b) => latest(b).localeCompare(latest(a)) || byName(a, b));
  skip.sort(byName);
  return { todo, done, skip, total: todo.length + done.length + skip.length };
}

// Only what the card and the email show — no notes, ratings or coordinates.
// `area` is the spot's first neighborhood / city, as Prep Day lists it.
export function publicSpot(r) {
  const area = Array.isArray(r.locations) ? r.locations.find((l) => typeof l === 'string' && l.trim()) : '';
  return {
    id: String(r.id || ''),
    name: String(r.name || '').trim() || 'Unnamed spot',
    url: typeof r.url === 'string' ? r.url : '',
    address: typeof r.address === 'string' ? r.address : '',
    area: area ? area.trim() : '',
    dish: typeof r.dish === 'string' ? r.dish : '',
    visited: r.status !== 'want-to-try',
    next: !!r.nextSpot && r.status === 'want-to-try',
    dates: guysNightDates(r),
  };
}

/* The list as the event shows it. Ruled-out spots ("not for guys night") are
   left out — they're a note to self, not something to suggest to the group —
   so the count is of the spots still in play: done + to go. */
export function steakhouseSummary(restaurants) {
  const { todo, done } = guysNightSections(restaurants);
  return {
    todo: todo.map(publicSpot),
    done: done.map(publicSpot),
    total: todo.length + done.length,
    doneCount: done.length,
  };
}

// A Google Maps search for the spot, when Prep Day has no link of its own.
export function spotLink(spot) {
  if (spot.url && /^https?:\/\//i.test(spot.url)) return spot.url;
  const q = [spot.name, spot.address || spot.area].filter(Boolean).join(' ');
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : '';
}
