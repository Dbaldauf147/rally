/* Which Friends are not on the wedding guest list.

   A friend counts as on the list when a guest is linked to them (friendId),
   or when an unlinked guest plainly is them — same name, same email, or the
   same ten-digit phone. The second half matters because most guests came in
   by import and were never linked; without it, half the guest list would show
   up again as "not invited". Deliberately looser than Auto-match Friends: a
   false "already on the list" hides a friend, but a false "not invited" just
   shows one you can ignore, and Auto-match refuses ambiguous keys because it
   writes a link, which this never does. */

export const normName = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const normEmail = (s) => (s || '').toLowerCase().trim();
export const normPhone = (s) => {
  const digits = (s || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
};

export function friendsNotOnList(friends, contacts) {
  const linked = new Set();
  const names = new Set();
  const emails = new Set();
  const phones = new Set();
  for (const c of contacts || []) {
    if (c.friendId) linked.add(c.friendId);
    const n = normName(`${c.firstName || ''}${c.lastName || ''}`);
    if (n) names.add(n);
    const e = normEmail(c.email);
    if (e) emails.add(e);
    const p = normPhone(c.phone);
    if (p) phones.add(p);
  }
  return (friends || [])
    .filter((f) => {
      if (linked.has(f.id)) return false;
      const n = normName(f.name);
      if (n && names.has(n)) return false;
      if ([f.email, f.workEmail].some((e) => normEmail(e) && emails.has(normEmail(e)))) return false;
      const p = normPhone(f.phone);
      if (p && phones.has(p)) return false;
      return true;
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

// A friend's first address, whichever shape it was saved in.
export function friendAddress(f) {
  if (Array.isArray(f?.addresses) && f.addresses.length) {
    const a = f.addresses.find((x) => (x?.value || x?.address || '').trim()) || f.addresses[0];
    return (a?.value || a?.address || '').trim();
  }
  return (f?.address || '').trim();
}

// The guest row a friend becomes when added. Last word of the name is the
// last name, so "Mary Ann Smith" files under Smith like the imported rows do.
export function guestFromFriend(f, id) {
  const parts = (f.name || '').trim().split(/\s+/).filter(Boolean);
  const lastName = parts.length > 1 ? parts.pop() : '';
  return {
    id,
    firstName: parts.join(' '),
    lastName,
    email: (f.email || f.workEmail || '').trim(),
    phone: (f.phone || '').trim(),
    address: friendAddress(f),
    friendId: f.id,
  };
}
