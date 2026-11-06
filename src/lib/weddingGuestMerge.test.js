import { describe, expect, it } from 'vitest';
import {
  applyGuestMerge,
  findGuestDuplicateGroups,
  friendChoicesFromGuest,
  guestMergeConflicts,
  guestMergeFriends,
  mergeGuests,
} from './weddingGuestMerge';

const g = (id, extra) => ({ id, firstName: '', lastName: '', ...extra });

describe('findGuestDuplicateGroups', () => {
  it('groups by email, phone, name and shared friend, chaining matches', () => {
    const groups = findGuestDuplicateGroups([
      g('a', { firstName: 'Ann', lastName: 'Lee', email: 'ANN@x.com' }),
      g('b', { firstName: 'Annie', lastName: 'Lee', email: 'ann@x.com', phone: '(555) 123-4567' }),
      g('c', { firstName: 'A', lastName: 'L', phone: '1-555-123-4567' }),
      g('d', { firstName: 'Bob', lastName: 'Ray', friendId: 'f1' }),
      g('e', { firstName: 'Robert', lastName: 'Ray', friendId: 'f1' }),
      g('f', { firstName: 'Solo', lastName: 'Guest' }),
    ]);
    expect(groups.map((x) => x.guests.map((y) => y.id))).toEqual([['a', 'b', 'c'], ['d', 'e']]);
    expect(groups[0].reasons).toEqual(['email', 'phone']);
    expect(groups[1].reasons).toEqual(['friend']);
  });

  it('matches names ignoring case and punctuation', () => {
    const groups = findGuestDuplicateGroups([
      g('a', { firstName: "O'Neil", lastName: 'Smith' }),
      g('b', { firstName: 'oneil', lastName: 'SMITH' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reasons).toEqual(['name']);
  });
});

describe('guestMergeConflicts', () => {
  it('lists only units that really differ, comparing loosely', () => {
    const c = guestMergeConflicts([
      g('a', { firstName: 'Ann', lastName: 'Lee', phone: '(555) 123-4567', email: 'a@x.com', city: 'NYC' }),
      g('b', { firstName: 'ann', lastName: 'lee', phone: '555-123-4567', email: 'b@x.com', city: 'Boston' }),
    ]);
    expect(c.map((x) => x.key)).toEqual(['email', 'address']);
    expect(c[0].values).toEqual([{ value: 'a@x.com', from: 'a' }, { value: 'b@x.com', from: 'b' }]);
  });
});

describe('mergeGuests', () => {
  const a = g('a', { firstName: 'Ann', lastName: 'Lee', email: 'a@x.com', category: 'Family', subcategory: 'Cousins', party: 'Lees', partyOrder: 2, rsvpNote: 'kept' });
  const b = g('b', { firstName: 'Annie', lastName: 'Leigh', phone: '555', address: '1 Main', city: 'Boston', state: 'MA', zip: '02101', category: 'Work', subcategory: '', status: 'Confirmed', extra: 'from b' });

  it('keeps the primary id and its values, fills blanks from the others', () => {
    const m = mergeGuests(a, [b], {}, 'f1');
    expect(m).toMatchObject({
      id: 'a', friendId: 'f1', firstName: 'Ann', lastName: 'Lee', email: 'a@x.com', phone: '555',
      address: '1 Main', city: 'Boston', state: 'MA', zip: '02101', category: 'Family', subcategory: 'Cousins',
      status: 'Confirmed', party: 'Lees', partyOrder: 2, rsvpNote: 'kept', extra: 'from b',
    });
  });

  it('takes a picked unit whole', () => {
    const m = mergeGuests(a, [b], { name: 'b', category: 'b' });
    expect(m.firstName).toBe('Annie');
    expect(m.lastName).toBe('Leigh');
    expect(m.category).toBe('Work');
    expect(m.subcategory).toBe('');
  });
});

describe('guestMergeFriends / friendChoicesFromGuest', () => {
  const friendsById = new Map([
    ['ann@x.com', { id: 'ann@x.com', name: 'Ann Lee', email: 'ann@x.com', birthday: '01-02' }],
    ['r1', { id: 'r1', name: 'Annie Lee', email: '', birthday: '03-04', phone: '555' }],
  ]);

  it('finds the distinct existing friends and keeps the email-keyed one', () => {
    const res = guestMergeFriends([
      g('a', { friendId: 'r1' }), g('b', { friendId: 'ann@x.com' }), g('c', { friendId: 'r1' }), g('d', { friendId: 'gone' }),
    ], friendsById);
    expect(res.friends.map((f) => f.id)).toEqual(['r1', 'ann@x.com']);
    expect(res.primary.id).toBe('ann@x.com');
    expect(res.others.map((f) => f.id)).toEqual(['r1']);
  });

  it('settles name from the guest pick and leaves the rest open', () => {
    const { choices, conflicts } = friendChoicesFromGuest(
      [friendsById.get('ann@x.com'), friendsById.get('r1')],
      { firstName: 'Annie', lastName: 'Lee' },
    );
    expect(choices).toEqual({ name: 'Annie Lee' });
    expect(conflicts.map((c) => c.key)).toEqual(['birthday']);
  });
});

describe('applyGuestMerge', () => {
  it('replaces the kept guest, drops the others, repoints removed friends', () => {
    const list = [g('a', { friendId: 'f1' }), g('b', { friendId: 'f2' }), g('c', { friendId: 'f2' }), g('d', { friendId: 'f3' })];
    const merged = { ...list[0], firstName: 'Merged', friendId: 'f1' };
    const out = applyGuestMerge(list, merged, ['b'], ['f2']);
    expect(out.map((x) => [x.id, x.friendId, x.firstName])).toEqual([
      ['a', 'f1', 'Merged'], ['c', 'f1', ''], ['d', 'f3', ''],
    ]);
  });
});
