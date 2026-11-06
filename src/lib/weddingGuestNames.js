/* A wedding guest linked to a Friends contact goes by that contact's name.

   Guests keep their own firstName / lastName (the table, sort, search, the
   Excel export and the weekly email all read them), so the contact's name is
   copied onto the guest whenever the two differ. A guest with no contact, or
   whose contact is gone or has no name, keeps the name it has. The name is
   only re-split when it actually changed, so "Mary Ann" / "Smith" survives. */

// "Mary Ann Smith" → first "Mary Ann", last "Smith".
export function splitGuestName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const lastName = parts.length > 1 ? parts.pop() : '';
  return { firstName: parts.join(' '), lastName };
}

const squash = (s) => String(s || '').trim().replace(/\s+/g, ' ');
export const fullGuestName = (g) => squash(`${g?.firstName || ''} ${g?.lastName || ''}`);

/* The guests with their linked contacts' names. Returns the same array when
   nothing differs, so a caller can tell whether there's anything to save. */
export function withFriendNames(guests, friendsById) {
  const list = Array.isArray(guests) ? guests : [];
  let changed = false;
  const next = list.map((g) => {
    const name = g?.friendId ? squash(friendsById?.get?.(g.friendId)?.name) : '';
    if (!name || name === fullGuestName(g)) return g;
    changed = true;
    return { ...g, ...splitGuestName(name) };
  });
  return changed ? next : list;
}
