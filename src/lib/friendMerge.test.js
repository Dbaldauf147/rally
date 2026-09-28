import { describe, it, expect } from 'vitest';
import { findDuplicateGroups, mergeConflicts, mergeFriends, repointFriendIds } from './friendMerge';

describe('findDuplicateGroups', () => {
  it('groups by email, phone digits or name, and says why', () => {
    const groups = findDuplicateGroups([
      { id: 'a', name: 'Pat Smith', email: 'pat@x.com' },
      { id: 'b', name: 'Patrick', email: 'PAT@x.com ' },
      { id: 'c', name: 'Jo Lee', phone: '(555) 123-4567' },
      { id: 'd', name: 'Joanne', phone: '+1 555.123.4567' },
      { id: 'e', name: 'sam  o’neil' },
      { id: 'f', name: 'Sam ONeil' },
      { id: 'g', name: 'Alone', phone: '12' },
      { id: 'h', name: 'Other', phone: '34' },
    ]);
    const ids = groups.map((g) => g.friends.map((f) => f.id).sort());
    expect(ids).toEqual([['c', 'd'], ['a', 'b'], ['e', 'f']]);
    expect(groups.map((g) => g.reasons)).toEqual([['phone'], ['email'], ['name']]);
  });

  it('chains matches into one group', () => {
    const groups = findDuplicateGroups([
      { id: 'a', name: 'A', email: 'a@x.com' },
      { id: 'b', name: 'B', email: 'a@x.com', phone: '5551234567' },
      { id: 'c', name: 'C', phone: '555-123-4567' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].friends.map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(groups[0].reasons).toEqual(['email', 'phone']);
  });

  it('matches a work email against a personal one', () => {
    const groups = findDuplicateGroups([{ id: 'a', name: 'A', email: 'a@corp.com' }, { id: 'b', name: 'B', workEmail: 'a@corp.com' }]);
    expect(groups).toHaveLength(1);
  });
});

describe('mergeConflicts', () => {
  it('lists fields with more than one real value, ignoring formatting', () => {
    const out = mergeConflicts([
      { id: 'a', name: 'Pat Smith', phone: '(555) 123-4567', email: 'pat@x.com', group: '' },
      { id: 'b', name: 'Patrick Smith', phone: '555-123-4567', email: 'PAT@x.com', group: 'Work' },
    ]);
    expect(out).toEqual([{ key: 'name', label: 'Name', values: [{ value: 'Pat Smith', from: 'a' }, { value: 'Patrick Smith', from: 'b' }] }]);
  });
});

describe('mergeFriends', () => {
  const primary = {
    id: 'a', name: 'Pat Smith', email: 'pat@x.com', phone: '', tag: 'VIP; Golf',
    addresses: [{ label: 'Home', value: '1 Main St' }], giftIdeas: ['Book'],
    kids: [{ name: 'Emma', birthday: '' }], notes: 'Met in college',
    profile: [{ id: 's1', title: 'Likes', items: [{ id: 'i1', text: 'Coffee', depth: 0 }] }],
    custom: { f1: 'x' }, createdAt: '2025-05-01T00:00:00.000Z', tier: 'A',
  };
  const dup = {
    id: 'b', name: 'Patrick Smith', email: '', phone: '555-123-4567', tag: 'golf;Travel', address: '1 main st',
    giftIdeas: ['book', 'Wine'], kids: [{ name: 'emma', birthday: '2019-03-14' }, { name: 'Liam', birthday: '' }],
    notes: 'Loves the Yankees', linkedTo: 'a',
    profile: [{ id: 's9', title: 'likes', items: [{ id: 'i9', text: 'coffee', depth: 0 }, { id: 'i8', text: 'Hiking', depth: 0 }] }, { id: 's2', title: 'Things I appreciate', items: [] }],
    custom: { f1: 'y', f2: 3 }, createdAt: '2024-01-01T00:00:00.000Z',
  };

  it('keeps the primary’s values, fills blanks, and combines the lists', () => {
    const m = mergeFriends(primary, [dup]);
    expect(m.name).toBe('Pat Smith');
    expect(m.phone).toBe('555-123-4567');
    expect(m.tier).toBe('A');
    expect(m.tag).toBe('VIP;Golf;Travel');
    expect(m.addresses).toEqual([{ label: 'Home', value: '1 Main St' }]);
    expect(m.address).toBe('1 Main St');
    expect(m.giftIdeas).toEqual(['Book', 'Wine']);
    expect(m.kids).toEqual([{ name: 'Emma', birthday: '2019-03-14' }, { name: 'Liam', birthday: '' }]);
    expect(m.notes).toBe('Met in college\n\nLoves the Yankees');
    expect(m.profile.map((s) => [s.title, s.items.map((i) => i.text)])).toEqual([['Likes', ['Coffee', 'Hiking']], ['Things I appreciate', []]]);
    expect(m.custom).toEqual({ f1: 'x', f2: 3 });
    expect(m.createdAt).toBe('2024-01-01T00:00:00.000Z');
    expect(m.id).toBeUndefined();
  });

  it('uses the value picked for a conflict', () => {
    expect(mergeFriends(primary, [dup], { name: 'Patrick Smith' }).name).toBe('Patrick Smith');
  });

  it('never links the merged contact to itself', () => {
    expect(mergeFriends(primary, [dup]).linkedTo).toBe('');
    expect(mergeFriends(primary, [{ ...dup, linkedTo: 'z' }]).linkedTo).toBe('z');
  });

  it('carries fields it does not know about', () => {
    expect(mergeFriends({ id: 'a', name: 'A' }, [{ id: 'b', name: 'B', lastSeen: '2026-01-01' }]).lastSeen).toBe('2026-01-01');
  });
});

describe('repointFriendIds', () => {
  it('points removed ids at the kept one', () => {
    const { next, changed } = repointFriendIds([{ id: 1, friendId: 'b' }, { id: 2, friendId: 'c' }, { id: 3 }], ['b'], 'a');
    expect(changed).toBe(true);
    expect(next.map((c) => c.friendId)).toEqual(['a', 'c', undefined]);
    expect(repointFriendIds([{ friendId: 'c' }], ['b'], 'a').changed).toBe(false);
  });
});
