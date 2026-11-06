// Finding and merging duplicate guests on the wedding guest list.
//
// Pure — no Firestore — so it can be unit-tested; WeddingPage does the writes.
// The Friends side of a merge (when the duplicates are linked to different
// Friends contacts) is friendMerge.js; this module only says which contacts
// those are and what to pick where they disagree.
//
// A merge keeps one guest (its id survives) and folds the others into it.
// Fields travel in units, so a choice never splices two people's data: the
// name is first + last together, the mailing address is street, city, state
// and zip together, a category brings its subcategory and a wedding group its
// place in that group. A unit the kept guest has blank is filled from the
// first duplicate that has it.

import { keepFirst, mergeConflicts } from './friendMerge';

const clean = (v) => String(v ?? '').trim();
const digits = (v) => clean(v).replace(/[^\d]/g, '');
const phoneKey = (v) => { const d = digits(v); return d.length >= 7 ? d.slice(-10) : ''; };
const nameKey = (v) => clean(v).toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
const fullName = (g) => `${clean(g?.firstName)} ${clean(g?.lastName)}`.trim();

// The units a merge chooses between, in the order the merge screen lists them.
// `show` is how one guest's value reads; `same` compares two loosely, so
// "(555) 123-4567" and "555-123-4567" aren't offered as a choice.
export const GUEST_MERGE_FIELDS = [
  { key: 'name', label: 'Name', fields: ['firstName', 'lastName'], show: fullName },
  { key: 'email', label: 'Email', fields: ['email'] },
  { key: 'phone', label: 'Phone', fields: ['phone'], same: (g) => phoneKey(g.phone) || clean(g.phone) },
  {
    key: 'address', label: 'Mailing address', fields: ['address', 'city', 'state', 'zip'],
    show: (g) => [clean(g.address), [clean(g.city), clean(g.state)].filter(Boolean).join(', '), clean(g.zip)].filter(Boolean).join(' · '),
  },
  { key: 'status', label: 'Status', fields: ['status'] },
  { key: 'group', label: 'Group', fields: ['group'] },
  {
    key: 'category', label: 'Category', fields: ['category', 'subcategory'],
    show: (g) => [clean(g.category), clean(g.subcategory)].filter(Boolean).join(' › '),
  },
  { key: 'guestOf', label: 'Guest of', fields: ['guestOf'] },
  { key: 'side', label: 'Side of the family', fields: ['side'] },
  { key: 'party', label: 'Wedding group', fields: ['party', 'partyOrder'], show: (g) => clean(g.party) },
];
const UNIT_KEYS = new Set(GUEST_MERGE_FIELDS.flatMap((u) => u.fields));

const showOf = (unit, g) => (unit.show ? unit.show(g) : clean(g[unit.fields[0]]));
const sameOf = (unit, g) => (unit.same ? unit.same(g) : showOf(unit, g).toLowerCase());

/* Groups of guests that look like the same person: the same email, the same
 * phone number (last ten digits), the same full name once case and
 * punctuation are ignored, or a link to the same Friends contact. Matches
 * chain, so a group can be more than two. Each group carries why it matched. */
export function findGuestDuplicateGroups(guests) {
  const list = Array.isArray(guests) ? guests : [];
  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const seen = new Map();
  const why = []; // [index, reason]
  list.forEach((g, i) => {
    const keys = [];
    if (clean(g.email)) keys.push(['email', clean(g.email).toLowerCase()]);
    if (phoneKey(g.phone)) keys.push(['phone', phoneKey(g.phone)]);
    if (nameKey(fullName(g))) keys.push(['name', nameKey(fullName(g))]);
    if (clean(g.friendId)) keys.push(['friend', clean(g.friendId)]);
    for (const [kind, value] of keys) {
      const k = `${kind}:${value}`;
      if (!seen.has(k)) { seen.set(k, i); continue; }
      const a = find(seen.get(k)); const b = find(i);
      if (a !== b) parent[b] = a;
      why.push([i, kind]);
    }
  });
  const groups = new Map();
  list.forEach((g, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, { guests: [], reasons: new Set() });
    groups.get(r).guests.push(g);
  });
  for (const [i, kind] of why) groups.get(find(i)).reasons.add(kind);
  return [...groups.values()]
    .filter((g) => g.guests.length > 1)
    .map((g) => ({ guests: g.guests, reasons: [...g.reasons].sort() }))
    .sort((a, b) => fullName(a.guests[0]).localeCompare(fullName(b.guests[0])));
}

// How complete a guest is — the fullest one is offered as the one to keep,
// after any that are linked to a Friends contact.
const filled = (g) => Object.values(g).filter((v) => v !== null && v !== undefined && clean(v) !== '').length;
export const guestKeepFirst = (a, b) => (!!clean(b.friendId) - !!clean(a.friendId)) || (filled(b) - filled(a));

/* Where the guests disagree: each unit with more than one distinct non-blank
 * value, as { key, label, values: [{ value, from }] } — `from` is the guest
 * that value comes from, which is also what a choice records. */
export function guestMergeConflicts(guests) {
  const out = [];
  for (const unit of GUEST_MERGE_FIELDS) {
    const values = [];
    const seen = new Set();
    for (const g of guests) {
      const value = showOf(unit, g);
      if (!value) continue;
      const k = sameOf(unit, g);
      if (seen.has(k)) continue;
      seen.add(k);
      values.push({ value, from: g.id });
    }
    if (values.length > 1) out.push({ key: unit.key, label: unit.label, values });
  }
  return out;
}

/* The merged guest, keeping `primary`'s id. `choices` maps a unit key to the
 * id of the guest whose value was picked for it. `friendId` is the Friends
 * contact the merged guest ends up linked to (see guestMergeFriends). */
export function mergeGuests(primary, others, choices = {}, friendId = primary.friendId || '') {
  const all = [primary, ...others];
  const byId = new Map(all.map((g) => [g.id, g]));
  const out = {};
  // Anything this module doesn't know about: the kept guest's, else whichever
  // duplicate has it.
  for (const g of [...all].reverse()) {
    for (const [k, v] of Object.entries(g)) {
      if (UNIT_KEYS.has(k) || k === 'id' || k === 'friendId') continue;
      if (v !== undefined && v !== null && v !== '') out[k] = v;
    }
  }
  for (const unit of GUEST_MERGE_FIELDS) {
    const src = byId.get(choices[unit.key]) || all.find((g) => showOf(unit, g)) || primary;
    for (const f of unit.fields) {
      const v = src[f];
      if (f === 'partyOrder') out[f] = typeof v === 'number' ? v : null;
      else out[f] = clean(v);
    }
  }
  out.id = primary.id;
  out.friendId = friendId || '';
  return out;
}

/* The Friends side. The distinct Friends contacts the guests are linked to
 * (only ones that still exist), and of those the one to keep and the ones to
 * fold into it — the same choice the Friends page's merge screen would offer
 * first. With fewer than two there's nothing to merge on the Friends page. */
export function guestMergeFriends(guests, friendsById) {
  const friends = [];
  for (const g of guests) {
    const f = friendsById?.get?.(clean(g.friendId));
    if (f && !friends.some((x) => x.id === f.id)) friends.push(f);
  }
  if (friends.length === 0) return { friends, primary: null, others: [] };
  const [primary, ...others] = [...friends].sort(keepFirst);
  return { friends, primary, others };
}

/* Settling the Friends contacts' disagreements. Name, email and phone follow
 * what was picked for the guest when it's one of the contacts' values, so the
 * two pages end up agreeing; the conflicts left over are returned to show. */
export function friendChoicesFromGuest(friends, mergedGuest) {
  const conflicts = mergeConflicts(friends);
  const guestValue = { name: fullName(mergedGuest), email: clean(mergedGuest.email), phone: clean(mergedGuest.phone) };
  const same = (key, v) => (key === 'phone' ? phoneKey(v) || clean(v) : clean(v).toLowerCase());
  const choices = {};
  const open = [];
  for (const c of conflicts) {
    const want = guestValue[c.key];
    const hit = want && c.values.find((v) => same(c.key, v.value) === same(c.key, want));
    if (hit) choices[c.key] = hit.value;
    else open.push(c);
  }
  return { choices, conflicts: open };
}

/* The whole guest list after the merge: the kept guest replaced by the merged
 * one, the others gone, and any other guest that pointed at a Friends contact
 * being folded away pointed at the kept one instead. */
export function applyGuestMerge(list, merged, removedGuestIds, removedFriendIds = []) {
  const removed = new Set(removedGuestIds);
  const goneFriends = new Set(removedFriendIds);
  return (Array.isArray(list) ? list : [])
    .filter((g) => !removed.has(g.id))
    .map((g) => {
      if (g.id === merged.id) return merged;
      if (goneFriends.has(g.friendId)) return { ...g, friendId: merged.friendId };
      return g;
    });
}
