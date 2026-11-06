// Writing a Friends merge to Firestore. The pure half — what the merged contact
// looks like — is friendMerge.js; this is the order the writes go in, shared by
// the Friends page's merge screen and the wedding guest list's.

import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { mergeFriends, repointFriendIds } from './friendMerge';

/* Fold `others` into `primary` under `uid`. The kept contact is written first
 * and the duplicates deleted last, so a failure part-way leaves an extra
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
  const userSnap = await getDoc(doc(db, 'users', uid));
  const data = userSnap.data() || {};
  const patch = {};
  for (const key of ['reachOuts', 'weddingContacts']) {
    const { next, changed } = repointFriendIds(data[key], removedIds, primary.id);
    if (changed) patch[key] = next;
  }
  if (Object.keys(patch).length) await setDoc(doc(db, 'users', uid), patch, { merge: true });
  for (const id of removedIds) {
    await deleteDoc(doc(db, 'users', uid, 'friends', id));
  }
  return merged;
}
