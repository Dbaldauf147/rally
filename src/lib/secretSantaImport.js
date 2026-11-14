// Loading past Secret Santa draws from pasted text (see lib/secretSanta.js for
// where a draw is stored).
//
// The text is whatever another app or a note shows, one pick per line:
//
//   Secret Santa 2025
//   Amanda drew Grace.
//   Dan drew Milan.
//
//   Christmas 2023
//   Amanda drew Sunnie.
//
// A line with a year in it and no pick starts a new draw; everything else that
// isn't a pick (dates, "View draw", lists of names) is ignored.

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const firstName = (s) => norm(s).split(' ')[0] || '';

const PICK = /^(.+?)\s+(?:drew|draws|has|had|got|gets|gives to|gave to|buys for|->|→|=>)\s+(.+?)[.!]?$/i;
const YEAR = /\b(19|20)\d{2}\b/;
const WEEKDAY = /^(mon|tues|wednes|thurs|fri|satur|sun)day\b/i;

/** Text → [{ title, year, pairs: [{ giver, receiver }] }], in the order pasted. */
export function parsePastDraws(text) {
  const draws = [];
  let current = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim().replace(/\s+/g, ' ');
    if (!line) continue;
    const pick = line.match(PICK);
    if (pick) {
      if (!current) { current = { title: '', year: null, pairs: [] }; draws.push(current); }
      const giver = pick[1].trim();
      const receiver = pick[2].trim();
      // One pick per giver: a repeated line replaces rather than doubles up.
      const at = current.pairs.findIndex((p) => norm(p.giver) === norm(giver));
      if (at >= 0) current.pairs[at] = { giver, receiver }; else current.pairs.push({ giver, receiver });
      continue;
    }
    const year = line.match(YEAR);
    // "Thursday, December 25, 2025" under a title is the same draw's date, not
    // the start of another one.
    if (year && !(current && current.pairs.length === 0 && WEEKDAY.test(line))) {
      current = { title: line, year: Number(year[0]), pairs: [] };
      draws.push(current);
    }
  }
  return draws.filter((d) => d.pairs.length > 0);
}

/** Every distinct name used across the given draws, in first-seen order. */
export function namesIn(draws) {
  const seen = new Map();
  for (const d of draws) {
    for (const p of d.pairs) {
      for (const n of [p.giver, p.receiver]) if (!seen.has(norm(n))) seen.set(norm(n), n);
    }
  }
  return [...seen.values()];
}

/**
 * The people a pasted name could be: this event's guests first, then Friends
 * contacts who aren't already a guest. Each is { id, key, name, email, source }
 * — `key` is the event member key, empty for someone only in Friends.
 */
export function importCandidates(members, friends) {
  const out = [];
  const emails = new Set();
  const names = new Set();
  for (const [key, m] of Object.entries(members && typeof members === 'object' ? members : {})) {
    if (!m || typeof m !== 'object') continue;
    out.push({ id: `m:${key}`, key, name: String(m.name || '').trim(), email: String(m.email || '').trim(), source: 'guest' });
    if (norm(m.email)) emails.add(norm(m.email));
    if (norm(m.name)) names.add(norm(m.name));
  }
  for (const f of Array.isArray(friends) ? friends : []) {
    if (!f || !f.id || !norm(f.name)) continue;
    if ((norm(f.email) && emails.has(norm(f.email))) || names.has(norm(f.name))) continue;
    out.push({ id: `f:${f.id}`, key: '', name: String(f.name).trim(), email: String(f.email || '').trim(), source: 'friend' });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Best guess at who a pasted name is: an exact full-name match, else the one
 * person with that first name. Guests are tried before the wider Friends list,
 * so "Mike" means the Mike who is coming. Returns a candidate id, or '' when
 * it's nobody or more than one person.
 */
export function matchName(name, candidates) {
  const full = norm(name);
  if (!full) return '';
  for (const source of ['guest', 'friend']) {
    const pool = candidates.filter((c) => c.source === source);
    const exact = pool.filter((c) => norm(c.name) === full);
    if (exact.length === 1) return exact[0].id;
    if (exact.length > 1) return '';
    const first = pool.filter((c) => firstName(c.name) === full);
    if (first.length === 1) return first[0].id;
    if (first.length > 1) return '';
  }
  return '';
}

/** The pairs to store for one draw, given name → candidate id ('' = keep the name as typed). */
export function importedPairs(draw, mapping, candidates) {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const ref = (name) => {
    const c = byId.get(mapping[name] || '');
    return c ? { key: c.key, name: c.name, email: c.email } : { key: '', name: String(name).trim(), email: '' };
  };
  return draw.pairs.map((p) => ({ giver: ref(p.giver), receiver: ref(p.receiver) }));
}

/**
 * The pairs to store after a past draw was edited by hand.
 *
 * Each row is { giver, receiver } as typed, plus — for a pick that was already
 * saved — the stored people (`giverRef`, `receiverRef`) and the names they were
 * shown under (`giverWas`, `receiverWas`). A name left untouched keeps its
 * stored person exactly; a changed or new name is matched like a pasted one
 * (matchName), falling back to the bare name. Blank rows are dropped.
 * Returns { pairs } or { error }.
 */
export function editedPairs(rows, candidates) {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const refFor = (text, was, ref) => {
    if (ref && norm(text) === norm(was)) return ref;
    const c = byId.get(matchName(text, candidates));
    return c ? { key: c.key, name: c.name, email: c.email } : { key: '', name: String(text).trim().replace(/\s+/g, ' '), email: '' };
  };
  const same = (a, b) => (a.key && a.key === b.key) || (norm(a.email) && norm(a.email) === norm(b.email)) || norm(a.name) === norm(b.name);
  const pairs = [];
  for (const row of rows || []) {
    const g = String(row.giver || '').trim();
    const r = String(row.receiver || '').trim();
    if (!g && !r) continue;
    if (!g || !r) return { error: `Every pick needs both names — ${g || r} is missing ${g ? 'who they drew' : 'who drew them'}.` };
    const pair = { giver: refFor(g, row.giverWas, row.giverRef), receiver: refFor(r, row.receiverWas, row.receiverRef) };
    if (same(pair.giver, pair.receiver)) return { error: `${g} can’t draw themselves.` };
    if (pairs.some((p) => same(p.giver, pair.giver))) return { error: `${g} is listed twice as the one drawing.` };
    pairs.push(pair);
  }
  if (pairs.length === 0) return { error: 'Add at least one pick.' };
  return { pairs };
}

/** Saved years with a draw, newest first — optionally only those before `beforeYear`. */
export function drawYears(history, beforeYear = Infinity) {
  return Object.keys(history && typeof history === 'object' ? history : {})
    .map(Number)
    .filter((y) => Number.isFinite(y) && y < beforeYear && history[y]?.pairs?.length > 0)
    .sort((a, b) => b - a);
}
