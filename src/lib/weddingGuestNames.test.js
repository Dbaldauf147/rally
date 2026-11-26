import { describe, it, expect } from 'vitest';
import { guestNameFromFriend, splitGuestName, withFriendNames } from './weddingGuestNames';

const friends = new Map([
  ['f1', { id: 'f1', name: 'Robert Smith' }],
  ['f2', { id: 'f2', name: 'Mary Ann  Jones ' }],
  ['f3', { id: 'f3', name: '' }],
]);

describe('splitGuestName', () => {
  it('puts the last word in lastName', () => {
    expect(splitGuestName('Mary Ann Smith')).toEqual({ firstName: 'Mary Ann', lastName: 'Smith' });
    expect(splitGuestName('Cher')).toEqual({ firstName: 'Cher', lastName: '' });
  });
});

describe('withFriendNames', () => {
  it('copies a linked contact’s name onto the guest', () => {
    const out = withFriendNames([{ id: 'a', friendId: 'f1', firstName: 'Bob', lastName: 'Smith', city: 'Boston' }], friends);
    expect(out[0]).toEqual({ id: 'a', friendId: 'f1', firstName: 'Robert', lastName: 'Smith', city: 'Boston' });
  });
  it('leaves the middle name off the guest', () => {
    const guests = [{ id: 'b', friendId: 'f2', firstName: 'Mary Ann', lastName: 'Jones' }];
    expect(withFriendNames(guests, friends)[0]).toMatchObject({ firstName: 'Mary', lastName: 'Jones' });
  });
  it('keeps a two-word first name the contact stores as its first name', () => {
    const f = new Map([['f9', { id: 'f9', name: 'Mary Ann Jones', firstName: 'Mary Ann', middleName: '', lastName: 'Jones' }]]);
    const guests = [{ id: 'b', friendId: 'f9', firstName: 'Mary Ann', lastName: 'Jones' }];
    expect(withFriendNames(guests, f)).toBe(guests);
  });
  it('uses the stored parts and drops a stored middle name', () => {
    const f = new Map([['s', { id: 's', name: 'Sally Edna Baldauf', firstName: 'Sally', middleName: 'Edna', lastName: 'Baldauf' }]]);
    const out = withFriendNames([{ id: 'x', friendId: 's', firstName: 'Sally Edna', lastName: 'Baldauf' }], f);
    expect(out[0]).toMatchObject({ firstName: 'Sally', lastName: 'Baldauf' });
    // Settled: a second pass has nothing to change, so the page doesn't keep saving.
    expect(withFriendNames(out, f)).toBe(out);
  });
  it('gives a one-word contact a first name only', () => {
    expect(guestNameFromFriend({ name: 'Kayleigh' })).toEqual({ firstName: 'Kayleigh', lastName: '' });
    expect(guestNameFromFriend({ name: '  ' })).toBe(null);
  });
  it('leaves unlinked guests, missing contacts and nameless contacts alone', () => {
    const guests = [
      { id: 'c', firstName: 'No', lastName: 'Link' },
      { id: 'd', friendId: 'gone', firstName: 'Lost', lastName: 'Contact' },
      { id: 'e', friendId: 'f3', firstName: 'Keep', lastName: 'Me' },
    ];
    expect(withFriendNames(guests, friends)).toBe(guests);
    expect(withFriendNames(guests, new Map())).toBe(guests);
  });
});
