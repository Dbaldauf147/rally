// Shared helpers for the friends collection at `users/{uid}/friends`.
//
// These lived inside FriendsPage until the poll page needed to add a friend
// too. Writing a friend has enough shape to it — the doc id doubles as the
// dedupe key, dates get normalized on the way in — that a second copy would
// have drifted, so the write and the date parsing live here and FriendsPage
// imports them.

import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

// The loose-date parsing lives in looseDate.js now (customFields.js needs it
// without Firestore in tow). Re-exported here so the callers that have always
// reached for it through friends.js still can.
export { pad2, parseLooseDate, validParts } from './looseDate';
import { parseLooseDate, validParts, pad2 } from './looseDate';


// Storage normalizers — anything unparseable becomes '' rather than corrupting
// the record with half-read text.
export function normalizeBirthday(input) {
  const p = parseLooseDate(input);
  return validParts(p) ? `${pad2(p.month)}-${pad2(p.day)}` : '';
}
export function normalizeDob(input) {
  const p = parseLooseDate(input);
  return validParts(p) && p.year ? `${p.year}-${pad2(p.month)}-${pad2(p.day)}` : '';
}

// User-defined fields (see lib/customFields.js) live in a `custom` map keyed by
// field id. Values arrive already coerced to the field's type; this only drops
// the empty ones, so a blank answer doesn't take up space on the record and
// "has a value" stays a simple truthiness test everywhere downstream.
export function cleanCustomValues(custom) {
  const out = {};
  if (!custom || typeof custom !== 'object') return out;
  for (const [key, value] of Object.entries(custom)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    out[key] = value;
  }
  return out;
}

// Write a friend under `uid`. The doc id is the lowercased email when there is
// one, so re-adding the same address overwrites rather than duplicating;
// without an email there's nothing stable to key on and a random id is used.
export async function addFriend(uid, data) {
  if (!uid || !data?.name?.trim()) return null;
  const id = data.email?.trim().toLowerCase() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cleanedAddresses = (data.addresses || [])
    .map(a => ({ label: (a.label || '').trim(), value: (a.value || '').trim() }))
    .filter(a => a.value);
  await setDoc(doc(db, 'users', uid, 'friends', id), {
    name: data.name.trim(),
    email: (data.email || '').trim().toLowerCase(),
    phone: (data.phone || '').trim(),
    group: (data.group || '').trim(),
    guest: (data.guest || '').trim(),
    tag: (data.tag || '').trim(),
    address: cleanedAddresses[0]?.value || (data.address || '').trim(),
    addresses: cleanedAddresses,
    workEmail: (data.workEmail || '').trim().toLowerCase(),
    instagram: (data.instagram || '').trim(),
    birthday: normalizeBirthday(data.birthday),
    dob: normalizeDob(data.dob),
    custom: cleanCustomValues(data.custom),
    createdAt: new Date().toISOString(),
  });
  return id;
}

// ── Matching a person against the friends list ────────────────────────────
// Mirrors EventDetail's member↔friend reconciliation: email, then phone
// digits, then full name, then a first name only when it's unambiguous. A
// first name shared by two friends matches neither, since guessing wrong is
// worse than asking.

const digitsOf = (v) => String(v || '').replace(/\D/g, '');

export function buildFriendIndex(friends) {
  const byEmail = new Map();
  const byPhone = new Map();
  const byName = new Map();
  const byFirst = new Map();
  const firstCounts = new Map();
  for (const f of friends || []) {
    const email = (f.email || '').trim().toLowerCase();
    if (email) byEmail.set(email, f);
    const phone = digitsOf(f.phone);
    if (phone.length >= 7) byPhone.set(phone.slice(-10), f);
    const name = (f.name || '').trim().toLowerCase();
    if (name) {
      byName.set(name, f);
      const first = name.split(/\s+/)[0];
      if (first) {
        firstCounts.set(first, (firstCounts.get(first) || 0) + 1);
        if (!byFirst.has(first)) byFirst.set(first, f);
      }
    }
  }
  return { byEmail, byPhone, byName, byFirst, firstCounts };
}

export function matchFriend(index, person) {
  if (!index || !person) return null;
  const email = (person.email || '').trim().toLowerCase();
  if (email && index.byEmail.has(email)) return index.byEmail.get(email);
  const phone = digitsOf(person.phone);
  if (phone.length >= 7 && index.byPhone.has(phone.slice(-10))) return index.byPhone.get(phone.slice(-10));
  const name = (person.name || '').trim().toLowerCase();
  if (!name) return null;
  if (index.byName.has(name)) return index.byName.get(name);
  const first = name.split(/\s+/)[0];
  if (first && index.firstCounts.get(first) === 1) return index.byFirst.get(first);
  return null;
}

// Event `members` keys are field-path segments, so the characters Firestore
// reads as structure — dots above all — have to go. Mirrors the key EventDetail
// builds when it adds a friend to an event, so the same person lands on the
// same key from either side.
export const sanitizeMemberKey = (v) => String(v || '').replace(/[.@#$/[\]]/g, '_').toLowerCase();

// One-off read of a user's friends, for callers that only need the list once
// and don't want to hold a subscription open.
export async function loadFriends(uid) {
  if (!uid) return [];
  const snap = await getDocs(collection(db, 'users', uid, 'friends'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
