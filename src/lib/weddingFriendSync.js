// Puts wedding guests on the Friends page: the Firestore half of
// planGuestFriendSync (lib/weddingGuestFriend.js).
//
// Runs once over the whole guest list (marked by `weddingFriendsSynced` on the
// user doc), then again only for guests as they're imported. It is not a
// standing mirror: a friend deleted on the Friends page stays deleted, and
// editing a guest doesn't rewrite their friend record.

import { collection, doc, getDoc, getDocs, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { addFriend } from './friends';
import { planGuestFriendSync } from './weddingGuestFriend';

export const SYNC_FLAG = 'weddingFriendsSynced';

// Friend writes go out a few at a time: 150-odd guests at once is a burst
// Firestore will take, but there's no reason to make it.
const CHUNK = 20;

export async function syncWeddingGuestsToFriends(uid, { onlyIds, markDone = false } = {}) {
  if (!uid) return { created: 0, linked: 0 };
  const userRef = doc(db, 'users', uid);
  const [userSnap, friendSnap] = await Promise.all([
    getDoc(userRef),
    getDocs(collection(db, 'users', uid, 'friends')),
  ]);
  const guests = userSnap.data()?.weddingContacts || [];
  const friends = friendSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const { creates, links } = planGuestFriendSync(guests, friends, { onlyIds });

  // Each new friend's real doc id, by the placeholder the plan gave it. One
  // that fails to write leaves its guests unlinked rather than stopping the
  // rest; Auto-match on the Wedding page can pick them up later.
  const realId = {};
  for (let i = 0; i < creates.length; i += CHUNK) {
    await Promise.all(creates.slice(i, i + CHUNK).map(async ({ tmpId, data }) => {
      try {
        const id = await addFriend(uid, data);
        if (id) realId[tmpId] = id;
      } catch (err) {
        console.error('Failed to add wedding guest to Friends:', data.name, err);
      }
    }));
  }

  // The links are written against the list as it is now, not as it was read
  // above: the guest list may have been edited while the friends were being
  // written, and those edits mustn't be lost. A guest linked by hand in the
  // meantime keeps the link they were given.
  let linked = 0;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    const current = snap.data()?.weddingContacts || [];
    linked = 0;
    const next = current.map((g) => {
      const planned = links[g.id];
      const friendId = planned && (realId[planned] || (planned.startsWith('__new_') ? '' : planned));
      if (!friendId || g.friendId) return g;
      linked += 1;
      return { ...g, friendId };
    });
    tx.set(userRef, {
      ...(linked ? { weddingContacts: next } : {}),
      ...(markDone ? { [SYNC_FLAG]: true } : {}),
    }, { merge: true });
  });
  return { created: Object.keys(realId).length, linked };
}
