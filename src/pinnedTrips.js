// Pinned trips appear as quick-access links in the top NavBar.
// Stored on this device in localStorage as [{ id, title }].
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

export function setPinnedTrips(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
  // Notify listeners in this tab (the native 'storage' event only fires in
  // other tabs, so we dispatch our own for same-tab reactivity).
  window.dispatchEvent(new Event(EVENT));
}

// Pin or unpin a trip. Returns true if it is now pinned.
export function togglePin(trip) {
  const list = getPinnedTrips();
  const exists = list.some(t => t.id === trip.id);
  const next = exists
    ? list.filter(t => t.id !== trip.id)
    : [...list, { id: trip.id, title: trip.title || 'Trip' }];
  setPinnedTrips(next);
  return !exists;
}

// Subscribe to pin changes (same-tab + cross-tab). Returns an unsubscribe fn.
export function subscribePins(cb) {
  const onChange = () => cb(getPinnedTrips());
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}
