// Secret Santa for an event's guest list.
//
// The organizer draws names on the event page; each person gives to exactly
// one other person and receives from exactly one. Nobody can draw
//   • themselves,
//   • their partner — the guest they come with (`plusOneOf` on the event
//     member, kept in step with Comes With on the Friends page), or
//   • the person they had the last time names were drawn.
//
// Where it is stored matters: an event doc is readable by every guest (and by
// anonymous poll voters), so the pairs are NOT kept there. They live on the
// organizer's own user doc, which only they can read:
//   users/{uid}.secretSanta.{eventId}.{year} = {
//     pairs: [{ giver: { key, name, email }, receiver: { key, name, email } }],
//     out: [memberKey…],          // guests sitting this year out
//     note, drawnAt, sentAt, sent: { [giverKey]: ISO }, manual?: true
//   }
// The event itself only carries the switch: `secretSanta: { enabled: true }`.
//
// One event can hold more than one exchange — the whole family's, and a
// smaller one among the siblings. The extra ones are listed on the organizer's
// user doc too, so a guest can't even see that they exist:
//   users/{uid}.secretSantaDraws.{eventId} = [{ id, name }]
// and each keeps its years beside the main one's, under its own key:
//   users/{uid}.secretSanta.{eventId~drawId}.{year}
// An extra exchange starts with nobody in it; the organizer adds who is.
//
// This file is imported by the browser and by api/secret-santa.js, so it stays
// free of Firebase and DOM imports.

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

export const MIN_PARTICIPANTS = 3;

export const MAX_EXTRA_DRAWS = 10;

/** Where one exchange's years are kept under `secretSanta` on the user doc. */
export const drawStoreKey = (eventId, drawId = '') => (drawId ? `${eventId}~${drawId}` : String(eventId));

export const cleanDrawName = (s) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 60);

/** The saved list of an event's extra exchanges, with anything malformed dropped. */
export function cleanDraws(list) {
  const seen = new Set();
  const out = [];
  for (const d of Array.isArray(list) ? list : []) {
    const id = String(d?.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 20);
    const name = cleanDrawName(d?.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out.slice(0, MAX_EXTRA_DRAWS);
}

/** What an email calls the exchange: the event, led by the extra exchange's own name. */
export function exchangeTitle(eventTitle, drawName) {
  const name = cleanDrawName(drawName);
  const title = String(eventTitle || '').trim();
  return name && title ? `${name} · ${title}` : name || title;
}

export function secretSantaEnabled(event) {
  return event?.secretSanta?.enabled === true;
}

/** A title that reads like a gift exchange — the event page then offers to set one up. */
export function looksLikeGiftExchange(title) {
  return /\b(secret\s*santa|christmas|xmas|x-mas|holiday party|gift (exchange|swap)|white elephant|yankee swap)\b/i.test(String(title || ''));
}

const memberEntries = (members) =>
  Object.entries(members && typeof members === 'object' ? members : {}).filter(([, m]) => m && typeof m === 'object');

export const personLabel = (m) => String(m?.name || m?.email || 'Unnamed guest').trim();

/** A guest as kept in a saved draw: enough to recognise them again next year. */
export const personRef = (key, m) => ({ key, name: String(m?.name || '').trim(), email: String(m?.email || '').trim() });

/**
 * The current member key a saved person refers to, or null if they are no
 * longer on the list. A member's key can change between years (an email key
 * becomes a uid once they sign in), so email and then name are the fallbacks.
 */
export function resolvePerson(ref, members) {
  if (!ref) return null;
  const entries = memberEntries(members);
  if (ref.key && entries.some(([k]) => k === ref.key)) return ref.key;
  const email = norm(ref.email);
  if (email) {
    const hit = entries.find(([, m]) => norm(m.email) === email);
    if (hit) return hit[0];
  }
  const name = norm(ref.name);
  if (name) {
    const hits = entries.filter(([, m]) => norm(m.name) === name);
    if (hits.length === 1) return hits[0][0];
  }
  return null;
}

/** Each guest's partner key(s): a `plusOneOf` link counts in both directions. */
export function partnersOf(members) {
  const out = new Map();
  const add = (a, b) => { if (!out.has(a)) out.set(a, new Set()); out.get(a).add(b); };
  const entries = memberEntries(members);
  const keys = new Set(entries.map(([k]) => k));
  for (const [key, m] of entries) {
    const p = m.plusOneOf;
    if (!p || p === key || !keys.has(p)) continue;
    add(key, p);
    add(p, key);
  }
  return out;
}

/** Guests in the draw by default: everyone who hasn't said no. */
export function defaultParticipants(members) {
  return memberEntries(members).filter(([, m]) => m.rsvp !== 'no').map(([k]) => k);
}

/**
 * The most recent draw before `year`, as { year, map } where map is
 * giverKey → receiverKey in terms of TODAY's member keys. People who have left
 * the list simply drop out of it.
 */
export function lastDraw(history, year, members) {
  const years = Object.keys(history && typeof history === 'object' ? history : {})
    .map(Number)
    .filter((y) => Number.isFinite(y) && y < year && Array.isArray(history[y]?.pairs) && history[y].pairs.length > 0)
    .sort((a, b) => b - a);
  if (years.length === 0) return { year: null, map: {} };
  const map = {};
  for (const p of history[years[0]].pairs) {
    const g = resolvePerson(p?.giver, members);
    const r = resolvePerson(p?.receiver, members);
    if (g && r && g !== r) map[g] = r;
  }
  return { year: years[0], map };
}

/** giverKey → Set of keys they may not draw. */
export function buildExclusions(keys, members, lastMap = {}) {
  const partners = partnersOf(members);
  const out = new Map();
  for (const key of keys) {
    const no = new Set([key]);
    for (const p of partners.get(key) || []) no.add(p);
    if (lastMap[key]) no.add(lastMap[key]);
    out.set(key, no);
  }
  return out;
}

function shuffled(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Draw names. Returns { giverKey: receiverKey } covering every key exactly
 * once on each side, or null when the rules leave no valid draw (say, two
 * couples and nobody else).
 *
 * A shuffled augmenting-path matching: it always finds a valid draw when one
 * exists, however tight the rules are, where "shuffle and retry" can spin.
 */
export function drawNames(keys, exclusions, rng = Math.random) {
  const list = [...new Set(keys)];
  if (list.length < 2) return null;
  const allowed = (g, r) => !(exclusions.get(g) || new Set([g])).has(r) && g !== r;
  const options = new Map(list.map((g) => [g, shuffled(list.filter((r) => allowed(g, r)), rng)]));
  const giverOf = new Map();

  function place(g, seen) {
    for (const r of options.get(g)) {
      if (seen.has(r)) continue;
      seen.add(r);
      if (!giverOf.has(r) || place(giverOf.get(r), seen)) {
        giverOf.set(r, g);
        return true;
      }
    }
    return false;
  }

  for (const g of shuffled(list, rng)) {
    if (!place(g, new Set())) return null;
  }
  const out = {};
  for (const [r, g] of giverOf) out[g] = r;
  return out;
}

/** Which rule, if any, a saved pair breaks — used to double-check a draw on screen. */
export function drawProblems(map, keys, exclusions) {
  const problems = [];
  const receivers = new Set();
  for (const g of keys) {
    const r = map?.[g];
    if (!r || !keys.includes(r)) { problems.push({ key: g, reason: 'missing' }); continue; }
    if (receivers.has(r)) problems.push({ key: g, reason: 'duplicate' });
    receivers.add(r);
    if ((exclusions.get(g) || new Set([g])).has(r)) problems.push({ key: g, reason: 'excluded' });
  }
  return problems;
}

/** True when a saved draw still covers exactly the people now taking part. */
export function drawMatchesParticipants(map, keys) {
  const givers = Object.keys(map || {});
  if (givers.length !== keys.length) return false;
  const set = new Set(keys);
  return givers.every((g) => set.has(g) && set.has(map[g])) && new Set(Object.values(map)).size === keys.length;
}

/**
 * Server side: turn the pairs the organizer sent into the emails to send.
 * Names and addresses are read from the EVENT, never from the request, so the
 * endpoint can only ever write to that event's own guests. Returns
 * { error } or { mail: [{ key, to, giverName, receiverName }], noEmail: [key] }.
 */
export function planSecretSantaSend(event, pairs, only = null) {
  const members = event?.members && typeof event.members === 'object' ? event.members : {};
  if (!Array.isArray(pairs) || pairs.length < 2) return { error: 'No names have been drawn.' };
  if (pairs.length > 200) return { error: 'Too many people.' };
  const givers = new Set();
  const receivers = new Set();
  for (const p of pairs) {
    const g = String(p?.giver || '');
    const r = String(p?.receiver || '');
    if (!members[g] || !members[r]) return { error: 'The guest list has changed since names were drawn — draw again.' };
    if (g === r) return { error: 'Somebody has drawn themselves — draw again.' };
    if (givers.has(g) || receivers.has(r)) return { error: 'The draw is not one-to-one — draw again.' };
    givers.add(g);
    receivers.add(r);
  }
  if ([...givers].some((g) => !receivers.has(g))) return { error: 'The draw is not one-to-one — draw again.' };

  const wanted = Array.isArray(only) && only.length > 0 ? new Set(only.map(String)) : null;
  const mail = [];
  const noEmail = [];
  for (const p of pairs) {
    if (wanted && !wanted.has(p.giver)) continue;
    const giver = members[p.giver];
    const to = String(giver.email || '').trim();
    if (!to) { noEmail.push(p.giver); continue; }
    mail.push({ key: p.giver, to, giverName: personLabel(giver), receiverName: personLabel(members[p.receiver]) });
  }
  return { mail, noEmail };
}
