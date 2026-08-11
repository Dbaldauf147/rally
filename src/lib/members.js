// One human, one member row.
//
// An event's `members` map is keyed by whichever code path happened to add the
// person: a Firebase Auth uid, a sanitized email (`a@b.com` -> `a_b_com`), a
// name slug (`mike_baldauf`), or a generated id (`1774912326729-p2f4vh`). Every
// writer used to re-implement its own dedupe against that — some matched email
// and name, some matched phone only, some matched nothing — so the same person
// routinely ended up under two keys with their votes split between the rows.
//
// Everything that adds someone to an event goes through here instead. The
// matching is deliberately generous (email, then phone, then name, across all
// four key shapes) because a duplicate row is much more annoying to unpick than
// an over-eager match is to correct.
//
// Writes are per-field, never a whole-object assignment: replacing `members.<k>`
// wholesale is what used to wipe the organizer's `plusOneOf`, `texted` and RSVP.
// Existing non-empty values are left alone; only gaps get filled.

import { arrayUnion } from 'firebase/firestore';

// Member keys replace . @ # $ / [ ] with _. Mirrored in AdminPage/FriendsPage/
// useEvents — those predate this module and still hold their own copy.
export function sanitizeKey(str) {
  return (str || '').replace(/[.@#$/[\]]/g, '_');
}

export const normEmail = (s) => (s || '').trim().toLowerCase();
export const normName = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();

// Compare phones by digits alone, dropping a US country code, so
// "(631) 988-2875", "6319889244" and "1 631 988 2875" are one person.
export function normPhone(s) {
  const d = (s || '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}

// The key a brand-new member would get. Email first so someone added before
// they had an account lines up with the email key useEvents auto-links on.
// Whitespace collapses to _ as well: these keys go into `members.<key>.<field>`
// update paths, and a space there is not a valid unquoted field path.
export function memberKeyFor(person) {
  return sanitizeKey(person?.email || person?.id || person?.name || '')
    .replace(/\s+/g, '_')
    .toLowerCase();
}

// Every identity a stored member row answers to: its own fields, plus the key
// itself when the key is a raw email or an email slug.
function identitiesOf(key, m) {
  const emails = new Set();
  const phones = new Set();
  const names = new Set();
  if (m && typeof m === 'object') {
    if (m.email) emails.add(normEmail(m.email));
    if (m.phone) phones.add(normPhone(m.phone));
    if (m.name) names.add(normName(m.name));
  }
  if (key.includes('@')) emails.add(normEmail(key));
  return { emails, phones, names, key: key.toLowerCase() };
}

// Find the key this person already occupies, or null. Order matters: email and
// phone identify a person, a shared name only suggests one, so `matchName` can
// be turned off where a false match would be costly.
export function findMemberKey(members, person, { matchName = true, skipKey = null } = {}) {
  const entries = Object.entries(members || {}).filter(([k, m]) => k !== skipKey && m && typeof m === 'object');
  const email = normEmail(person?.email);
  const phone = normPhone(person?.phone);
  const name = normName(person?.name);
  const wantKeys = new Set([
    person?.id ? String(person.id).toLowerCase() : null,
    email ? sanitizeKey(email) : null,
    memberKeyFor(person) || null,
  ].filter(Boolean));

  const rows = entries.map(([k, m]) => [k, identitiesOf(k, m)]);
  // Exact key first — a caller that already knows the key shouldn't be second-guessed.
  for (const [k, id] of rows) if (wantKeys.has(id.key)) return k;
  if (email) for (const [k, id] of rows) if (id.emails.has(email)) return k;
  if (phone) for (const [k, id] of rows) if (id.phones.has(phone)) return k;
  if (matchName && name) for (const [k, id] of rows) if (id.names.has(name)) return k;
  return null;
}

// Field-path updates that either fill gaps on the row this person already
// occupies or create a new one. `rsvp`/`role` are applied to an existing row
// only when explicitly passed, so adding someone twice can't reset their answer
// or demote an owner.
export function planMemberUpsert(members, person, opts = {}) {
  const { role, rsvp, extra, matchName = true } = opts;
  const key = opts.key || findMemberKey(members, person, { matchName }) || memberKeyFor(person);
  const existing = (members || {})[key];
  const isNew = !existing || typeof existing !== 'object';
  const fields = {};
  const fill = (field, value) => {
    if (!value) return;
    if (isNew || !existing[field]) fields[`members.${key}.${field}`] = value;
  };
  fill('name', person?.name);
  fill('email', person?.email);
  fill('phone', person?.phone);
  if (isNew) {
    fields[`members.${key}.role`] = role || 'viewer';
    fields[`members.${key}.rsvp`] = rsvp || 'pending';
  } else if (rsvp) {
    fields[`members.${key}.rsvp`] = rsvp;
  }
  for (const [k, v] of Object.entries(extra || {})) {
    if (v !== undefined) fields[`members.${key}.${k}`] = v;
  }
  return { key, isNew, fields };
}

// Batch form. Each person is matched against the rows added earlier in the same
// batch as well as the stored ones, so adding the same human twice in one go
// still lands on a single row.
export function planMemberUpserts(members, people, opts = {}) {
  const working = { ...(members || {}) };
  const updates = {};
  const results = [];
  for (const person of people) {
    const perOpts = typeof opts === 'function' ? opts(person) : opts;
    const { key, isNew, fields } = planMemberUpsert(working, person, perOpts);
    Object.assign(updates, fields);
    // Make this row visible to the next person in the batch.
    working[key] = {
      ...(working[key] && typeof working[key] === 'object' ? working[key] : {}),
      name: person?.name || working[key]?.name || '',
      email: person?.email || working[key]?.email || '',
      phone: person?.phone || working[key]?.phone || '',
    };
    results.push({ person, key, isNew });
  }
  const keys = [...new Set(results.map(r => r.key))];
  if (keys.length) updates.memberUids = arrayUnion(...keys);
  return { updates, keys, results, added: results.filter(r => r.isNew), merged: results.filter(r => !r.isNew) };
}
