// A Friends merge puts the duplicates in the trash instead of deleting them.
import { describe, it, expect, vi } from 'vitest';

const writes = [];
vi.mock('../firebase', () => ({ db: {}, auth: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...segs) => ({ path: segs.join('/') }),
  setDoc: async (ref, data) => { writes.push(['set', ref.path, data]); },
  updateDoc: async (ref, data) => { writes.push(['update', ref.path, data]); },
  runTransaction: async (_db, fn) => fn({
    get: async () => ({ data: () => ({ weddingContacts: [{ id: 'g1', friendId: 'dup' }, { id: 'g2', friendId: 'other' }] }) }),
    set: (ref, data) => { writes.push(['tx.set', ref.path, data]); },
  }),
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
    expect(writes.map((w) => `${w[0]} ${w[1]}`)).toEqual(['set users/u1/friends/keep', 'update users/u1/friends/kid', 'tx.set users/u1']);
    expect(writes[2][2].weddingContacts).toEqual([{ id: 'g1', friendId: 'keep' }, { id: 'g2', friendId: 'other' }]);
    expect(trashFriends).toHaveBeenCalledWith(['dup'], 'merged into Ann Keeper');
  });

  it('fails without losing anyone when the trash cannot be reached', async () => {
    trashFriends.mockRejectedValueOnce(new Error('offline'));
    await expect(commitFriendMerge('u1', [], { id: 'keep', name: 'A' }, [{ id: 'dup', name: 'B' }], {})).rejects.toThrow('offline');
  });
});
