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

/* Which guests still need a Friends contact, and which friend each one gets.

   Every guest not yet linked to a friend is matched against the friends list
   (findFriendForGuest); a hit is linked, a miss gets a new friend. Left out:
   guests in the "Hide" category (taken off the list), guests with no name
   (nothing to file a friend under), and guests whose linked friend has since
   been deleted — that was done on purpose on the Friends page, and bringing
   the contact back would undo it.

   New friends join the list being matched against as they're planned, so two
   guests who are the same person (same email, phone or full name) share one
   new friend instead of making two — and, with an email, instead of the second
   write overwriting the first under the same doc id.

   Returns { creates: [{ tmpId, data }], links: { guestId: friendId | tmpId } }.
   `onlyIds` limits it to those guests (a fresh import). */
export function planGuestFriendSync(guests, friends, { onlyIds } = {}) {
  const list = Array.isArray(friends) ? [...friends] : [];
  const only = onlyIds ? new Set(onlyIds) : null;
  const creates = [];
  const links = {};
  for (const g of Array.isArray(guests) ? guests : []) {
    if (!g || !g.id) continue;
    if (only && !only.has(g.id)) continue;
    if (norm(g.category) === 'hide') continue;
    if (g.friendId) continue;
    const hit = findFriendForGuest(list, g);
    if (hit) {
      links[g.id] = hit.id;
      continue;
    }
    const data = friendDataFromGuest(g);
    if (!data) continue;
    const tmpId = `__new_${creates.length}`;
    creates.push({ tmpId, data });
    list.push({ id: tmpId, name: data.name, email: data.email, phone: data.phone });
    links[g.id] = tmpId;
  }
  return { creates, links };
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
