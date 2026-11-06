import { describe, it, expect } from 'vitest';
import { splitGuestName, withFriendNames } from './weddingGuestNames';

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
  it('keeps the split when the full name already matches', () => {
    const guests = [{ id: 'b', friendId: 'f2', firstName: 'Mary', lastName: 'Ann Jones' }];
    expect(withFriendNames(guests, friends)).toBe(guests);
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
