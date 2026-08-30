// Reading and writing the shared page-visibility doc.
//
// Split from pagePrivacy.js so the route-key helpers there stay pure and
// testable — importing this pulls in firebase.js, which initialises the SDK on
// load and can't run under vitest. Same split as lib/expenses.js.
//
// The doc is `appConfig/pageVisibility`, holding { private: { plans: true } }.
// Every signed-in user must be able to READ it — a viewer can only hide a page
// if they know it's hidden — while only the owner may write. firestore.rules is
// where that asymmetry is actually enforced; this file just assumes it.

import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

const configRef = () => doc(db, 'appConfig', 'pageVisibility');

/* Stream the private-page map. Any read failure yields an empty map — nothing
   hidden — on purpose: a transient Firestore error shouldn't black out the app
   for everyone, and this hides pages, it doesn't secure them. */
export function subscribePagePrivacy(cb) {
  try {
    return onSnapshot(
      configRef(),
      (snap) => {
        const v = snap.exists() ? snap.data()?.private : null;
        cb(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      },
      () => cb({}),
    );
  } catch {
    cb({});
    return () => {};
  }
}

// Merge-writes just the one key, so two pages toggled in quick succession
// don't clobber each other.
export function setPagePrivate(key, isPrivate) {
  return setDoc(configRef(), { private: { [key]: !!isPrivate } }, { merge: true });
}
