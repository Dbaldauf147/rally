// The Friends trash — the rules and the Firestore work, shared by the endpoint
// (api/people-trash.js) and the daily run that empties it (api/people-backup.js).
//
// Deleting a contact, or merging one into another, used to remove its document
// for good. Now the document is moved to peopleTrash/{uid}/items first — a
// place only the Admin SDK reaches — and stays there for thirty days, from
// where it can be put back exactly as it was, under the same id, so anything
// that pointed at it (a wedding guest, a Reach Out row) points at it again.
import { treePhotoIds } from '../src/lib/familyTree.js';

export const TRASH_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const CHUNK = 50;

const itemsOf = (db, uid) => db.collection(`peopleTrash/${uid}/items`);
const friendsOf = (db, uid) => db.collection(`users/${uid}/friends`);
const inChunks = async (list, fn) => {
  const out = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(...await Promise.all(list.slice(i, i + CHUNK).map(fn)));
  return out;
};

export const isExpired = (item, now = Date.now()) => now - (item.deletedAt || 0) > TRASH_DAYS * DAY;
export const daysLeft = (item, now = Date.now()) => Math.max(0, Math.ceil((item.deletedAt + TRASH_DAYS * DAY - now) / DAY));

/* Moves contacts to the trash. The copy is written before the contact is
   deleted, so a failure between the two leaves a contact that is in both
   places, never in neither. Ids that aren't contacts are skipped. */
export async function trashFriends(db, uid, ids, { reason = 'deleted', now = Date.now() } = {}) {
  const unique = [...new Set((ids || []).map(String))];
  const done = await inChunks(unique, async (friendId) => {
    const ref = friendsOf(db, uid).doc(friendId);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    const item = itemsOf(db, uid).doc();
    await item.set({ friendId, name: data.name || '', data, deletedAt: now, reason: String(reason).slice(0, 200) });
    await ref.delete();
    return { itemId: item.id, friendId, name: data.name || '' };
  });
  return done.filter(Boolean);
}

/* What's in the trash, newest first, without the contacts themselves. */
export async function listTrash(db, uid, now = Date.now()) {
  const snap = await itemsOf(db, uid).select('friendId', 'name', 'deletedAt', 'reason').get();
  return snap.docs
    .map((d) => ({ itemId: d.id, ...d.data() }))
    .filter((i) => !isExpired(i, now))
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .map((i) => ({ itemId: i.itemId, friendId: i.friendId, name: i.name || '', deletedAt: i.deletedAt, reason: i.reason || '', daysLeft: daysLeft(i, now) }));
}

/* Puts contacts back as they were, under their old ids. One whose id is in
   use again (the same email was re-added since) is left in the trash rather
   than laid over the newer contact. */
export async function restoreTrash(db, uid, itemIds) {
  const restored = [];
  const skipped = [];
  await inChunks([...new Set((itemIds || []).map(String))], async (itemId) => {
    const item = itemsOf(db, uid).doc(itemId);
    const snap = await item.get();
    if (!snap.exists) return;
    const { friendId, name, data } = snap.data();
    const ref = friendsOf(db, uid).doc(String(friendId));
    if ((await ref.get()).exists) { skipped.push(name || friendId); return; }
    await ref.set(data || {});
    await item.delete();
    restored.push(name || friendId);
  });
  return { restored, skipped };
}

/* Empties what has been in the trash longer than thirty days, and with each
   contact the family-tree photos that were its own — but only photos no
   contact still uses, since a merge can carry a photo over to the one kept. */
export async function purgeTrash(db, uid, now = Date.now()) {
  const snap = await itemsOf(db, uid).get();
  const expired = snap.docs.map((d) => ({ itemId: d.id, ...d.data() })).filter((i) => isExpired(i, now));
  if (!expired.length) return 0;
  const live = await friendsOf(db, uid).get();
  const inUse = new Set(live.docs.flatMap((d) => treePhotoIds(d.data()?.familyTree, d.data()?.kids)));
  // …or by a contact still waiting in the trash, who may yet come back.
  for (const d of snap.docs) {
    const i = d.data();
    if (!isExpired(i, now)) for (const pid of treePhotoIds(i.data?.familyTree, i.data?.kids)) inUse.add(pid);
  }
  await inChunks(expired, async (i) => {
    for (const pid of treePhotoIds(i.data?.familyTree, i.data?.kids)) {
      if (!inUse.has(pid)) await db.collection(`users/${uid}/familyPhotos`).doc(pid).delete().catch(() => {});
    }
    await itemsOf(db, uid).doc(i.itemId).delete();
  });
  return expired.length;
}
