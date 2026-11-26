import { collection, doc, getDocFromServer, getDocsFromServer, runTransaction, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import {
  mergeGuestList, checkRemovals, touchedIds, planGuestDocWrites, saveSteps, validGuestId,
  migrationBlocker, sameGuests, GUEST_COLLECTIONS, STORE_FLAG, usesGuestDocs,
} from './weddingGuestSave';

/* The one way a guest list is written.

   lists: { weddingContacts: { base, next, removing }, weddingContactsV2: … }
     base     — the list the caller was looking at
     next     — the list it wants
     removing — ids it means to delete (anything else that would disappear
                stops the save; see checkRemovals)
   …or a function of the user document as it stands inside the transaction,
   returning { lists: { key: { next, removing } }, extra } — for a change
   worked out from the stored list itself (base is then that list).
   extra: other fields of the user document to write in the same step.

   Runs as a transaction. Where the guests are stored decides what it writes:

   • Before an account has moved (the list is an array on the user document):
     the caller's changes are merged into the stored array and it is written
     back (lib/weddingGuestSave.js).
   • After (one document per guest, users/{uid}/weddingGuests/{id}): only the
     guests that changed are read and written, each edit applied to that
     guest's own document. The array is brought along in the same step as a
     copy for whole-list readers.

   A transaction needs the server — offline, this fails and says so.
   Returns the lists as written (the array copy), by key. */
export const guestsCollection = (uid, key) => collection(db, 'users', uid, GUEST_COLLECTIONS[key]);
const guestRef = (uid, key, id) => doc(db, 'users', uid, GUEST_COLLECTIONS[key], id);

async function commit(uid, resolve) {
  const ref = doc(db, 'users', uid);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists() ? snap.data() : {};
    const { lists, extra = {} } = resolve(data);
    const perGuest = usesGuestDocs(data);
    const written = {};
    const plans = [];
    // Every read comes before any write, as a transaction requires.
    for (const [key, { base = data[key], next, removing = [] }] of Object.entries(lists)) {
      const { list, removed } = mergeGuestList(base, next, data[key]);
      checkRemovals(removed, removing);
      written[key] = list;
      if (!perGuest) continue;
      const ids = touchedIds(base, next);
      for (const id of ids) if (!validGuestId(id)) throw new Error('A guest needs an id to be saved');
      const snaps = await Promise.all(ids.map((id) => tx.get(guestRef(uid, key, id))));
      const current = new Map(snaps.filter((s) => s.exists()).map((s) => [s.id, s.data()]));
      const plan = planGuestDocWrites(base, next, current);
      checkRemovals(plan.deletes, removing);
      plans.push({ key, plan });
    }
    for (const { key, plan } of plans) {
      for (const g of plan.sets) tx.set(guestRef(uid, key, g.id), g);
      for (const id of plan.deletes) tx.delete(guestRef(uid, key, id));
    }
    if (Object.keys(extra).length || Object.keys(written).length) tx.set(ref, { ...extra, ...written }, { merge: true });
    return written;
  });
}

export async function saveGuestLists(uid, lists, { extra = {} } = {}) {
  if (!uid) throw new Error('Not signed in');
  if (typeof lists === 'function') return commit(uid, lists);
  // A save that touches a great many guests (a big import, renaming a group
  // everyone is in) goes in steps, so no one commit is too large.
  const steps = Object.fromEntries(Object.entries(lists).map(([key, l]) => [key, saveSteps(l.base, l.next)]));
  const rounds = Math.max(1, ...Object.values(steps).map((s) => s.length));
  let written = {};
  for (let r = 0; r < rounds; r += 1) {
    const round = {};
    for (const [key, l] of Object.entries(lists)) {
      const s = steps[key];
      if (r >= s.length) continue;
      round[key] = { base: r === 0 ? l.base : s[r - 1], next: s[r], removing: l.removing };
    }
    written = { ...written, ...await commit(uid, () => ({ lists: round, extra: r === rounds - 1 ? extra : {} })) };
  }
  return written;
}

/* Moves an account's guest lists from the array on the user document to one
   document per guest. Safe to call on every load: it does nothing once the
   account has moved, and nothing at all if it can't finish.

     1. Read both lists from the server.
     2. Write every guest as their own document; remove any left by an
        earlier attempt that aren't on the list.
     3. Read the documents back from the server and check they match the
        lists, guest for guest and field for field.
     4. Only then mark the account as moved — and only if the lists are still
        what step 1 read.

   Until step 4 the app keeps using the array, so a failure anywhere leaves
   things exactly as they were. The usual reason it can't run is that the
   database rules for the new location haven't been published yet
   (firestore.rules): that reads as { moved: false, reason: 'rules' }. */
export async function moveGuestListsToDocuments(uid) {
  const ref = doc(db, 'users', uid);
  const snap = await getDocFromServer(ref);
  const data = snap.exists() ? snap.data() : {};
  if (usesGuestDocs(data)) return { moved: false, reason: 'already' };
  const lists = Object.fromEntries(Object.keys(GUEST_COLLECTIONS).map((key) => [key, Array.isArray(data[key]) ? data[key] : []]));
  if (!lists.weddingContacts.length) return { moved: false, reason: 'empty' };
  for (const list of Object.values(lists)) {
    const why = migrationBlocker(list);
    if (why) return { moved: false, reason: why };
  }
  try {
    for (const [key, list] of Object.entries(lists)) {
      const existing = await getDocsFromServer(guestsCollection(uid, key));
      const keep = new Set(list.map((g) => g.id));
      const ops = [
        ...list.map((g) => (b) => b.set(guestRef(uid, key, g.id), g)),
        ...existing.docs.filter((d) => !keep.has(d.id)).map((d) => (b) => b.delete(d.ref)),
      ];
      for (let i = 0; i < ops.length; i += 400) {
        const batch = writeBatch(db);
        for (const op of ops.slice(i, i + 400)) op(batch);
        await batch.commit();
      }
      const back = await getDocsFromServer(guestsCollection(uid, key));
      if (!sameGuests(back.docs.map((d) => d.data()), list)) return { moved: false, reason: 'the copy did not match' };
    }
  } catch (err) {
    return { moved: false, reason: err?.code === 'permission-denied' ? 'rules' : (err?.message || 'failed') };
  }
  return runTransaction(db, async (tx) => {
    const now = (await tx.get(ref)).data() || {};
    if (usesGuestDocs(now)) return { moved: false, reason: 'already' };
    for (const [key, list] of Object.entries(lists)) {
      if (!sameGuests(Array.isArray(now[key]) ? now[key] : [], list)) return { moved: false, reason: 'the list changed meanwhile' };
    }
    tx.set(ref, { [STORE_FLAG]: 'docs' }, { merge: true });
    return { moved: true, guests: lists.weddingContacts.length };
  });
}

/* Brings the array copy back in line with the guest documents. The documents
   are the list; the copy is only ever corrected from them. */
export const repairGuestListCopy = (uid, key, guests) => setDoc(doc(db, 'users', uid), { [key]: guests }, { merge: true });
