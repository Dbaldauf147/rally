// Deleting a contact puts it in the trash (api/people-trash.js) instead of
// removing it: thirty days in which it can be put back as it was.
//
// The move is done by the server, which keeps the trash where no page can
// write to it. If the server can't be reached the contact is not deleted —
// the call throws and the contact stays where it is.
import { auth } from '../firebase';

async function call(body) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const res = await fetch('/api/people-trash', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

// → [{ itemId, friendId, name }] for the contacts that were moved.
export const trashFriends = async (ids, reason = 'deleted') => (await call({ action: 'trash', ids, reason })).trashed || [];
export const listTrash = async () => (await call({ action: 'list' })).items || [];
// → { restored: [names], skipped: [names] }
export const restoreTrash = (itemIds) => call({ action: 'restore', itemIds });
