// A guest added by hand on the Wedding page also becomes a contact on the
// Friends page. These are the pure halves of that: whether the person is
// already a friend, and what the new friend record holds if not.
//
// Matching is deliberately stricter than lib/friends.js matchFriend: that one
// falls back to an unambiguous first name, which is fine for linking a poll
// voter but wrong here — "Sarah Smith" must not be folded into the only Sarah
// you already know. Email, phone digits or the exact full name, nothing looser.

const norm = (v) => String(v || '').trim().toLowerCase();
const phoneKey = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};

export const guestFullName = (g) =>
  `${String(g?.firstName || '').trim()} ${String(g?.lastName || '').trim()}`.trim();

export function findFriendForGuest(friends, guest) {
  if (!guest) return null;
  const list = Array.isArray(friends) ? friends : [];
  const email = norm(guest.email);
  if (email) {
    // A friend's doc id is their lowercased email (lib/friends.js addFriend),
    // so this also catches the one record a fresh write would overwrite.
    const hit = list.find((f) => norm(f.email) === email || norm(f.workEmail) === email || f.id === email);
    if (hit) return hit;
  }
  const phone = phoneKey(guest.phone);
  if (phone) {
    const hit = list.find((f) => phoneKey(f.phone) === phone);
    if (hit) return hit;
  }
  const name = norm(guestFullName(guest));
  if (name) {
    const hits = list.filter((f) => norm(f.name) === name);
    // Two friends with the same name: linking either would be a guess.
    if (hits.length === 1) return hits[0];
  }
  return null;
}

// The guest's address is split into street/city/state/zip on the Wedding page;
// a friend holds one address line, so it's joined as it would be written.
export function guestAddressLine(g) {
  const street = String(g?.address || '').trim();
  const city = String(g?.city || '').trim();
  const stateZip = [String(g?.state || '').trim(), String(g?.zip || '').trim()].filter(Boolean).join(' ');
  return [street, city, stateZip].filter(Boolean).join(', ');
}

// The data handed to lib/friends.js addFriend, or null when the guest has no
// name to file a friend under.
export function friendDataFromGuest(g) {
  const name = guestFullName(g);
  if (!name) return null;
  const address = guestAddressLine(g);
  return {
    name,
    email: String(g.email || '').trim(),
    phone: String(g.phone || '').trim(),
    addresses: address ? [{ label: 'Home', value: address }] : [],
  };
}
