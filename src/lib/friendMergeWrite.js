// Writing a Friends merge to Firestore. The pure half — what the merged contact
// looks like — is friendMerge.js; this is the order the writes go in, shared by
// the Friends page's merge screen and the wedding guest list's.

import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { mergeFriends, repointFriendIds } from './friendMerge';
import { trashFriends } from './friendTrash';
import { saveGuestLists } from './weddingGuestStore';

/* Fold `others` into `primary` under `uid`. The kept contact is written first
 * and the duplicates trashed last, so a failure part-way leaves an extra
 * contact rather than a lost one. In between, everything that points at a
 * removed contact by id is moved to the kept one: other friends' "comes with"
 * link (`friends` is the current list, to find them), and the Reach Out and
 * wedding lists on the user doc. Returns the merged contact. */
export async function commitFriendMerge(uid, friends, primary, others, choices) {
  const removedIds = others.map((f) => f.id);
  const merged = mergeFriends(primary, others, choices);
  await setDoc(doc(db, 'users', uid, 'friends', primary.id), merged);
  for (const f of friends || []) {
    if (f.id !== primary.id && !removedIds.includes(f.id) && removedIds.includes(f.linkedTo)) {
      await updateDoc(doc(db, 'users', uid, 'friends', f.id), { linkedTo: primary.id }).catch(() => {});
    }
  }
  // Read and written in one step, against the server's copy: these are whole
  // lists, and one rewritten from an out-of-date read would undo newer edits.
  await saveGuestLists(uid, (data) => {
    const lists = {};
    const extra = {};
    for (const key of ['weddingContacts', 'weddingContactsV2']) {
      const { next, changed } = repointFriendIds(data[key], removedIds, primary.id);
      // Guests that were the same person twice fold into one row; say which
      // rows go, so the save knows the list is meant to get shorter.
      const kept = new Set(next.map((g) => g?.id));
      const removing = (Array.isArray(data[key]) ? data[key] : []).map((g) => g?.id).filter((id) => id != null && !kept.has(id));
      if (changed) lists[key] = { next, removing };
    }
    const reach = repointFriendIds(data.reachOuts, removedIds, primary.id);
    if (reach.changed) extra.reachOuts = reach.next;
    return { lists, extra };
  });
  // The duplicates go to the trash rather than out of existence, so a merge
  // that folded the wrong people together can be taken apart again.
  await trashFriends(removedIds, `merged into ${merged.name || 'another contact'}`);
  return merged;
}
