// Pinned trips appear as quick-access links in the top NavBar.
//
// Source of truth is the user's account (users/{uid}.pinnedTrips in Firestore)
// so pins survive refresh and follow the user across devices. localStorage is
// kept as a fast-paint cache (and the fallback when signed out). A same-tab
// custom event keeps the NavBar and the event page in sync instantly.
//
// The account can't be trusted blindly, though. In the native shell Firestore
// runs on a memory-only cache (see firebase.js), so a write that hasn't
// flushed when the app is backgrounded is lost outright — there is no
// IndexedDB queue to resume from. localStorage still says "unpinned", the menu
// looks right, and then the next snapshot restores the pin from the server.
// So every toggle also records what the user meant in a durable pending list,
// and each snapshot is reconciled against it before being believed. Only a
// snapshot the server actually confirmed may clear that list — see
// subscribePins.
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';

const KEY = 'rally.pinnedTrips';
const PENDING_KEY = 'rally.pinnedTrips.pending';
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

// { [id]: { op: 'add' | 'remove', title?: string } } — toggles the account
// hasn't confirmed yet. Survives an app kill because localStorage does.
function getPending() {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || '{}');
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
}

function setPending(p) {
  try {
    if (Object.keys(p).length === 0) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch { /* a full or blocked store just costs us the retry */ }
}

// Does the account already reflect what the user wanted?
function isSatisfied(serverList, id, op) {
  const present = serverList.some(t => t.id === id);
  return op === 'remove' ? !present : present;
}

// The account's list with the user's unconfirmed intent laid back over it.
function applyPending(serverList, pending) {
  const out = serverList.filter(t => !(pending[t.id]?.op === 'remove'));
  for (const [id, rec] of Object.entries(pending)) {
    if (rec?.op === 'add' && !out.some(t => t.id === id)) {
      out.push({ id, title: rec.title || 'Trip' });
    }
  }
  return out;
}

function sameList(a, b) {
  return a.length === b.length && a.every((t, i) => t.id === b[i].id);
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

  // Recorded before the write goes out, so a kill mid-flight still leaves
  // evidence of what was wanted. A later toggle of the same trip overwrites
  // this entry rather than stacking up.
  const pending = getPending();
  pending[trip.id] = exists
    ? { op: 'remove' }
    : { op: 'add', title: trip.title || 'Trip' };
  setPending(pending);

  if (uid) {
    try {
      await setDoc(doc(db, 'users', uid), { pinnedTrips: next }, { merge: true });
      // Confirmed. Drop the marker unless the user toggled again while this
      // was in flight, in which case the newer intent stands.
      const after = getPending();
      const stillMine = exists ? after[trip.id]?.op === 'remove' : after[trip.id]?.op === 'add';
      if (stillMine) {
        delete after[trip.id];
        setPending(after);
      }
    } catch (err) {
      // Left pending on purpose — the next snapshot re-issues it.
      console.error('Failed to save pinned trips:', err);
    }
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
      // Firestore echoes our own un-acknowledged write straight back as a
      // snapshot, and it looks exactly like the server agreeing. Believing that
      // echo is what kept re-pinning trips: the pending marker was dropped as
      // "settled", then the app was killed before the write ever left the
      // device, the memory-only cache went with it, and the next real snapshot
      // brought the pin back with nothing left to say otherwise. Intent may
      // only be settled or re-sent once the server has actually confirmed.
      const confirmed = !snap.metadata.hasPendingWrites && !snap.metadata.fromCache;

      const v = snap.exists() ? snap.data().pinnedTrips : undefined;
      if (Array.isArray(v)) {
        const server = v.filter(t => t && t.id);
        const pending = getPending();

        // Anything the account already agrees with is settled.
        if (confirmed) {
          let changed = false;
          for (const [id, rec] of Object.entries(pending)) {
            if (isSatisfied(server, id, rec?.op)) { delete pending[id]; changed = true; }
          }
          if (changed) setPending(pending);
        }

        const merged = applyPending(server, pending);
        localStorage.setItem(KEY, JSON.stringify(merged));
        cb(merged);

        // A toggle that never reached the account: send it again rather than
        // letting the server quietly win. Only off a confirmed snapshot —
        // re-issuing on our own echo would write in a loop.
        if (confirmed && !sameList(merged, server)) {
          setDoc(doc(db, 'users', uid), { pinnedTrips: merged }, { merge: true }).catch(() => {});
        }
      } else if (confirmed) {
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
