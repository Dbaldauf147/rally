// "Dan's Gifts": the tab on an event with a Secret Santa that gathers the
// people its owner is buying for — whoever they drew in each draw on the
// event, plus a few people they always buy for — with the gift ideas saved
// for each of them on the Friends page (`giftIdeas` on the friend doc).
//
// It shows the owner's own Secret Santa pick, so it is theirs alone: the
// event page offers the tab only to the app's owner. Nothing here is stored
// on the event. Joanne, Mom and Dad are always on the list; anyone added on
// top of them is kept on the owner's user doc:
//   giftPeople: { [eventId]: [name…] }

// The people the owner buys for every year, whatever the draw: they lead the
// list on every event and can't be taken off it. `relation` is how the list
// names them beside their own name. A single name ("Joanne") finds the one
// Friends contact with that first name — see findFriend.
export const ALWAYS_GIFT_PEOPLE = [
  { name: 'Joanne', relation: '' },
  { name: 'Sally Baldauf', relation: 'Mom' },
  { name: 'Brian Baldauf', relation: 'Dad' },
];

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

const alwaysEntry = (name) => ALWAYS_GIFT_PEOPLE.find((p) => norm(p.name) === norm(name));

export const isAlwaysGiftPerson = (name) => !!alwaysEntry(name);

/** "Mom" for Sally Baldauf; '' for anyone the list has no word for. */
export const giftRelation = (name) => alwaysEntry(name)?.relation || '';

/**
 * Everyone the owner buys for besides their Secret Santa picks: the people
 * they always buy for, then the extras saved for the event — tidied, with no
 * blanks and no repeats.
 */
export function giftPeople(saved) {
  const seen = new Set();
  const out = [];
  for (const raw of [...ALWAYS_GIFT_PEOPLE.map((p) => p.name), ...(Array.isArray(saved) ? saved : [])]) {
    const name = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!name || seen.has(norm(name))) continue;
    seen.add(norm(name));
    out.push(name);
  }
  return out;
}

/** The part of the list that is saved: the extras, without the always-people. */
export const extraGiftPeople = (list) => giftPeople(list).filter((n) => !isAlwaysGiftPerson(n));

/**
 * The Friends contact for a person: by email first, then by a name only one
 * contact has. A one-word name with no exact match falls back to the only
 * contact with that first name, so "Joanne" finds "Joanne (Joo Yeon) Seo".
 */
export function findFriend(friends, person) {
  const list = (Array.isArray(friends) ? friends : []).filter((f) => f && typeof f === 'object');
  const email = norm(person?.email);
  if (email) {
    const hit = list.find((f) => norm(f.email) === email);
    if (hit) return hit;
  }
  const name = norm(person?.name);
  if (!name) return null;
  const hits = list.filter((f) => norm(f.name) === name);
  if (hits.length > 0) return hits.length === 1 ? hits[0] : null;
  if (name.includes(' ')) return null;
  const first = list.filter((f) => norm(f.name).split(' ')[0] === name);
  return first.length === 1 ? first[0] : null;
}

/** A friend's gift ideas as clean lines. */
export function giftIdeasOf(friend) {
  return (Array.isArray(friend?.giftIdeas) ? friend.giftIdeas : [])
    .map((g) => String(g ?? '').trim())
    .filter(Boolean);
}

/**
 * Who `me` drew in one draw's record for the year: the receiver as
 * { key, name, email }, or null when nothing is drawn or they aren't in it.
 * `me` is { uid, email }; the giver is matched by member key, then email.
 */
export function myPick(record, me) {
  const pairs = Array.isArray(record?.pairs) ? record.pairs : [];
  const email = norm(me?.email);
  const mine = pairs.find((p) => p?.giver && ((me?.uid && p.giver.key === me.uid) || (email && norm(p.giver.email) === email)));
  if (!mine?.receiver) return null;
  return { key: String(mine.receiver.key || ''), name: String(mine.receiver.name || '').trim(), email: String(mine.receiver.email || '').trim() };
}

/**
 * A line of text as pieces to render: plain text and links. Only http(s)
 * addresses become links, and punctuation that ends a sentence stays out of
 * the address.
 */
export function linkify(text) {
  const out = [];
  const re = /https?:\/\/[^\s<>"']+/g;
  const s = String(text ?? '');
  let last = 0;
  for (const m of s.matchAll(re)) {
    let url = m[0];
    const trail = url.match(/[.,;:!?)\]]+$/);
    if (trail) url = url.slice(0, -trail[0].length);
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ text: url, href: url });
    last = m.index + url.length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}
