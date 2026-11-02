import { describe, it, expect } from 'vitest';
import { friendsNotOnList, guestFromFriend, friendAddress } from './weddingFriendMatch';

const friends = [
  { id: 'f1', name: 'Zoe Linked' },
  { id: 'f2', name: "Bill O'Neill" },
  { id: 'f3', name: 'Email Match', workEmail: 'Work@Example.com' },
  { id: 'f4', name: 'Phone Match', phone: '+1 (631) 555-0100' },
  { id: 'f5', name: 'Not Invited' },
  { id: 'f6', name: 'Another Outsider', phone: '555' },
];
const contacts = [
  { id: 'c1', firstName: 'Someone', lastName: 'Else', friendId: 'f1' },
  { id: 'c2', firstName: 'Bill', lastName: 'ONeill' },
  { id: 'c3', firstName: 'X', lastName: 'Y', email: ' work@example.com ' },
  { id: 'c4', firstName: 'P', lastName: 'Q', phone: '631-555-0100' },
  { id: 'c5', firstName: '', lastName: '', phone: '555' },
];

describe('friendsNotOnList', () => {
  it('drops friends linked, or matched by name, email or phone; keeps the rest sorted', () => {
    expect(friendsNotOnList(friends, contacts).map((f) => f.id)).toEqual(['f6', 'f5']);
  });
  it('treats an empty guest list as nobody invited', () => {
    expect(friendsNotOnList(friends, [])).toHaveLength(friends.length);
  });
});

describe('guestFromFriend', () => {
  it('splits the name on the last word and links the friend', () => {
    const g = guestFromFriend(
      { id: 'f9', name: 'Mary Ann Smith', workEmail: 'm@x.com', addresses: [{ label: 'Home', value: '' }, { value: '1 Main St' }] },
      'g1',
    );
    expect(g).toEqual({ id: 'g1', firstName: 'Mary Ann', lastName: 'Smith', email: 'm@x.com', phone: '', address: '1 Main St', friendId: 'f9' });
  });
  it('reads a legacy single address', () => {
    expect(friendAddress({ address: ' 2 Elm ' })).toBe('2 Elm');
  });
});
