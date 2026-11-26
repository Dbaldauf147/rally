/* global Buffer */
// The daily backup file of everything Rally holds about people — the rules,
// kept apart from the endpoint (api/people-backup.js) so they can be tested
// without Firestore.
//
// One file is a complete, readable copy: every Friends contact with every
// field on it (family tree, kids, likes, custom fields…), and the lists on the
// user document that are made of people — both wedding guest lists and their
// groups, Reach Out, the gift list, and the custom field definitions the
// contacts' values are keyed by.
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const FILE_VERSION = 1;

// Fields of users/{uid} that are about people. A new one belongs here.
export const PEOPLE_FIELDS = [
  'weddingContacts', 'weddingContactsV2', 'weddingGroups', 'weddingGroupDescriptions',
  'weddingSides', 'weddingCategories', 'weddingHiddenFriendIds',
  'reachOuts', 'giftPeople', 'friendFields',
];

const arr = (v) => (Array.isArray(v) ? v : []);
// Key order doesn't change what a record says, so it mustn't change the
// fingerprint either (Firestore doesn't promise one).
// A Firestore Timestamp is written as the ISO date it stands for.
const stable = (v) => {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString();
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  return v;
};

/* The file. `friends` are [{ id, ...fields }]. */
export function buildPeopleFile({ userData = {}, friends = [], now = Date.now() }) {
  const user = {};
  for (const k of PEOPLE_FIELDS) if (userData[k] !== undefined) user[k] = userData[k];
  const sorted = [...friends].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    app: 'Rally',
    kind: 'people-backup',
    version: FILE_VERSION,
    exportedAt: new Date(now).toISOString(),
    counts: countsOf(sorted, user),
    friends: stable(sorted),
    user: stable(user),
  };
}

export function countsOf(friends, user = {}) {
  return {
    friends: arr(friends).length,
    guests: arr(user.weddingContacts).length,
    guestsV2: arr(user.weddingContactsV2).length,
    reachOuts: arr(user.reachOuts).length,
  };
}

// What the file says, whenever it was written.
export const fileFingerprint = (file) => createHash('sha1')
  .update(JSON.stringify([file.friends, file.user])).digest('hex');

export const fileName = (iso, kind = 'people') => `rally-${kind}-${String(iso).slice(0, 10)}.json`;

const LABELS = { friends: 'contacts', guests: 'wedding guests', guestsV2: 'second-version guests', reachOuts: 'Reach Out entries' };

/* Lines for the email: what moved since the last file. */
export function changesSince(prev, cur) {
  if (!prev) return [];
  return Object.keys(LABELS)
    .map((k) => ({ k, d: (cur[k] || 0) - (prev[k] || 0) }))
    .filter((x) => x.d)
    .map(({ k, d }) => `${d > 0 ? '+' : '−'}${Math.abs(d)} ${LABELS[k]}`);
}

/* A drop worth a warning: five or more gone at once and at least a tenth of
   the list. A person or two removed is ordinary; this is the shape of a wipe. */
export function dropWarnings(prev, cur) {
  if (!prev) return [];
  const out = [];
  for (const k of Object.keys(LABELS)) {
    const was = prev[k] || 0;
    const lost = was - (cur[k] || 0);
    if (lost >= 5 && lost >= was * 0.1) out.push(`${lost} of ${was} ${LABELS[k]} are gone since the last backup`);
  }
  return out;
}

/* Firestore caps a document at 1 MiB, so the gzipped file is stored in pieces. */
export const CHUNK_BYTES = 900 * 1024;
export function toChunks(file) {
  const gz = gzipSync(Buffer.from(JSON.stringify(file)));
  const chunks = [];
  for (let i = 0; i < gz.length; i += CHUNK_BYTES) chunks.push(gz.subarray(i, i + CHUNK_BYTES));
  return chunks;
}
export const fromChunks = (chunks) => JSON.parse(gunzipSync(Buffer.concat(chunks.map((c) => Buffer.from(c)))).toString('utf8'));

/* Contacts in the file that aren't in Friends now — what a restore adds back.
   Nothing that exists is overwritten and nothing is deleted. */
export function missingFriends(file, currentIds) {
  const have = new Set(currentIds);
  return arr(file?.friends).filter((f) => f && f.id != null && !have.has(f.id));
}

export const photosFingerprint = (photos) => createHash('sha1')
  .update(JSON.stringify([...photos].sort((a, b) => String(a.id).localeCompare(String(b.id))).map(stable))).digest('hex');
