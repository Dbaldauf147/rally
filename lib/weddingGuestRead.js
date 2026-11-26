// Reading and replacing the wedding guest lists from the server, wherever an
// account keeps them: an array on the user document, or — once it has moved
// (src/lib/weddingGuestStore.js) — one document per guest, with that array
// kept as a copy. The documents are the list; the copy only gives the order.
import { GUEST_COLLECTIONS, usesGuestDocs, inListOrder, migrationBlocker } from '../src/lib/weddingGuestSave.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const CHUNK = 50;

/* A user document with its guest lists as they really are. */
export async function withGuestLists(db, uid, userData = {}) {
  if (!usesGuestDocs(userData)) return userData;
  const out = { ...userData };
  for (const [key, name] of Object.entries(GUEST_COLLECTIONS)) {
    const snap = await db.collection(`users/${uid}/${name}`).get();
    out[key] = inListOrder(snap.docs.map((d) => ({ ...d.data(), id: d.id })), arr(userData[key]));
  }
  return out;
}

/* Replaces one list with `guests` (a restore). For an account on per-guest
   documents: every guest is written, the copy on the user document follows,
   and documents for guests not in `guests` go last — so a failure part-way
   leaves extra guests, never missing ones. */
export async function replaceGuestList(db, uid, userData, key, guests) {
  const userRef = db.doc(`users/${uid}`);
  if (!usesGuestDocs(userData)) {
    await userRef.set({ [key]: guests }, { mergeFields: [key] });
    return;
  }
  const why = migrationBlocker(guests);
  if (why) throw new Error(`That copy can’t be restored as it is: ${why}`);
  const col = db.collection(`users/${uid}/${GUEST_COLLECTIONS[key]}`);
  for (let i = 0; i < guests.length; i += CHUNK) {
    await Promise.all(guests.slice(i, i + CHUNK).map((g) => col.doc(g.id).set(g)));
  }
  await userRef.set({ [key]: guests }, { mergeFields: [key] });
  const keep = new Set(guests.map((g) => g.id));
  const extra = (await col.get()).docs.filter((d) => !keep.has(d.id));
  for (let i = 0; i < extra.length; i += CHUNK) {
    await Promise.all(extra.slice(i, i + CHUNK).map((d) => col.doc(d.id).delete()));
  }
}
