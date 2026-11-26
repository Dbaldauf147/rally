// A Friends merge puts the duplicates in the trash instead of deleting them.
import { describe, it, expect, vi } from 'vitest';

const writes = [];
vi.mock('../firebase', () => ({ db: {}, auth: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...segs) => ({ path: segs.join('/') }),
  setDoc: async (ref, data) => { writes.push(['set', ref.path, data]); },
  updateDoc: async (ref, data) => { writes.push(['update', ref.path, data]); },
}));
// The guest lists go through the one save path; this stands in for it with a
// stored list to work from.
vi.mock('./weddingGuestStore', () => ({
  saveGuestLists: async (uid, resolve) => {
    const out = resolve({ weddingContacts: [{ id: 'g1', friendId: 'dup' }, { id: 'g2', friendId: 'other' }], reachOuts: [{ friendId: 'dup' }] });
    writes.push(['guests', `users/${uid}`, out]);
  },
}));
const trashFriends = vi.fn(async () => []);
vi.mock('./friendTrash', () => ({ trashFriends: (...a) => trashFriends(...a) }));

const { commitFriendMerge } = await import('./friendMergeWrite');

describe('commitFriendMerge', () => {
  it('writes the kept contact, repoints the guest list, then trashes the duplicate', async () => {
    const primary = { id: 'keep', name: 'Ann Keeper', email: 'ann@x.test' };
    const dup = { id: 'dup', name: 'Ann K', phone: '555' };
    const merged = await commitFriendMerge('u1', [primary, dup, { id: 'kid', linkedTo: 'dup' }], primary, [dup], {});
    expect(merged.name).toBe('Ann Keeper');
    expect(writes.map((w) => `${w[0]} ${w[1]}`)).toEqual(['set users/u1/friends/keep', 'update users/u1/friends/kid', 'guests users/u1']);
    expect(writes[2][2].lists.weddingContacts.next).toEqual([{ id: 'g1', friendId: 'keep' }, { id: 'g2', friendId: 'other' }]);
    expect(writes[2][2].lists.weddingContactsV2).toBeUndefined();
    expect(writes[2][2].extra.reachOuts).toEqual([{ friendId: 'keep' }]);
    expect(trashFriends).toHaveBeenCalledWith(['dup'], 'merged into Ann Keeper');
  });

  it('fails without losing anyone when the trash cannot be reached', async () => {
    trashFriends.mockRejectedValueOnce(new Error('offline'));
    await expect(commitFriendMerge('u1', [], { id: 'keep', name: 'A' }, [{ id: 'dup', name: 'B' }], {})).rejects.toThrow('offline');
  });
});
