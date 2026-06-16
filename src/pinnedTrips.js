// Pinned trips appear as quick-access links in the top NavBar.
//
// Source of truth is the user's account (users/{uid}.pinnedTrips in Firestore)
// so pins survive refresh and follow the user across devices. localStorage is
// kept as a fast-paint cache (and the fallback when signed out). A same-tab
// custom event keeps the NavBar and the event page in sync instantly.
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';

const KEY = 'rally.pinnedTrips';
const EVENT = 'rally-pins-changed';

export function getPinnedTrips() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter(t => t && t.id) : [];
  } catch {
    return [];
  }
}

export function isPinned(id) {
  return getPinnedTrips().some(t => t.id === id);
}

function writeCache(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
  // Same-tab reactivity (the native 'storage' event only fires in other tabs).
  window.dispatchEvent(new Event(EVENT));
}

// Pin or unpin a trip. Writes through to the account (when signed in) and the
// local cache. Returns true if it is now pinned.
export async function togglePin(uid, trip) {
  const list = getPinnedTrips();
  const exists = list.some(t => t.id === trip.id);
  const next = exists
    ? list.filter(t => t.id !== trip.id)
    : [...list, { id: trip.id, title: trip.title || 'Trip' }];
  writeCache(next);
  if (uid) {
    try { await setDoc(doc(db, 'users', uid), { pinnedTrips: next }, { merge: true }); }
    catch (err) { console.error('Failed to save pinned trips:', err); }
  }
  return !exists;
}

// Subscribe to pin changes. Streams the account's pins (source of truth) and
// also listens for same-tab/cross-tab cache changes. Returns an unsubscribe fn.
export function subscribePins(uid, cb) {
  const onLocal = () => cb(getPinnedTrips());
  window.addEventListener(EVENT, onLocal);
  window.addEventListener('storage', onLocal);

  let unsubFs = () => {};
  if (uid) {
    unsubFs = onSnapshot(doc(db, 'users', uid), (snap) => {
      const v = snap.exists() ? snap.data().pinnedTrips : undefined;
      if (Array.isArray(v)) {
        // Account is the source of truth — refresh the cache and the UI.
        const clean = v.filter(t => t && t.id);
        localStorage.setItem(KEY, JSON.stringify(clean));
        cb(clean);
      } else {
        // Never saved to the account yet — migrate any local pins up once.
        const local = getPinnedTrips();
        if (local.length > 0) {
          setDoc(doc(db, 'users', uid), { pinnedTrips: local }, { merge: true }).catch(() => {});
        }
      }
    });
  }

  return () => {
    window.removeEventListener(EVENT, onLocal);
    window.removeEventListener('storage', onLocal);
    unsubFs();
  };
}
