import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { mergeGuestList, checkRemovals } from './weddingGuestSave';

/* The one way a guest list is written.

   lists: { weddingContacts: { base, next, removing }, weddingContactsV2: … }
     base     — the list the caller was looking at
     next     — the list it wants
     removing — ids it means to delete (anything else that would disappear
                stops the save; see checkRemovals)
   extra: other fields of the user document to write in the same step.

   Runs as a transaction: the stored list is read, the caller's changes are
   merged into it (lib/weddingGuestSave.js) and the result written, so a page
   with an out-of-date copy can't overwrite newer work. A transaction needs
   the server — offline, this fails and says so, where a plain write would
   have queued a whole-list overwrite to land later.

   Returns the lists as written, by key. */
export async function saveGuestLists(uid, lists, { extra = {} } = {}) {
  if (!uid) throw new Error('Not signed in');
  const ref = doc(db, 'users', uid);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists() ? snap.data() : {};
    const written = {};
    for (const [key, { base, next, removing = [] }] of Object.entries(lists)) {
      const { list, removed } = mergeGuestList(base, next, data[key]);
      checkRemovals(removed, removing);
      written[key] = list;
    }
    tx.set(ref, { ...extra, ...written }, { merge: true });
    return written;
  });
}
