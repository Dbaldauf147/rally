/* A wedding guest linked to a Friends contact goes by that contact's name —
   first and last only. The guest list is for invitations and seating, so a
   middle name the contact carries ("Sally Edna Baldauf") stays on the Friends
   page and the guest reads "Sally Baldauf".

   Guests keep their own firstName / lastName (the table, sort, search, the
   Excel export and the weekly email all read them), so the contact's name is
   copied onto the guest whenever the two differ. A guest with no contact, or
   whose contact is gone or has no name, keeps the name it has.

   The contact's first and last come from its stored name parts when they
   still spell its name (lib/friendName.js), so a two-word first name entered
   as such in the Friends pop-up ("Mary Ann") is kept whole; otherwise the
   first word is the first name and the last word the last. */

import { namePartsOf } from './friendName';

// "Mary Ann Smith" → first "Mary Ann", last "Smith".
export function splitGuestName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const lastName = parts.length > 1 ? parts.pop() : '';
  return { firstName: parts.join(' '), lastName };
}

const squash = (s) => String(s || '').trim().replace(/\s+/g, ' ');
export const fullGuestName = (g) => squash(`${g?.firstName || ''} ${g?.lastName || ''}`);

/* The name a contact gives its guest: { firstName, lastName }, no middle
   name. null for a contact with no name. */
export function guestNameFromFriend(friend) {
  if (!squash(friend?.name)) return null;
  const { firstName, lastName } = namePartsOf(friend);
  return { firstName: squash(firstName), lastName: squash(lastName) };
}

/* The guests with their linked contacts' names. Returns the same array when
   nothing differs, so a caller can tell whether there's anything to save. */
export function withFriendNames(guests, friendsById) {
  const list = Array.isArray(guests) ? guests : [];
  let changed = false;
  const next = list.map((g) => {
    const want = g?.friendId ? guestNameFromFriend(friendsById?.get?.(g.friendId)) : null;
    if (!want || (want.firstName === squash(g.firstName) && want.lastName === squash(g.lastName))) return g;
    changed = true;
    return { ...g, ...want };
  });
  return changed ? next : list;
}
