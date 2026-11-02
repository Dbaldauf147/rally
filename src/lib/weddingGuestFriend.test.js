import { describe, it, expect } from 'vitest';
import { findFriendForGuest, friendDataFromGuest, guestAddressLine } from './weddingGuestFriend';

const friends = [
  { id: 'amy@x.com', name: 'Amy Lee', email: 'amy@x.com', phone: '' },
  { id: '1', name: 'Sarah Jones', email: '', phone: '(555) 123-4567' },
  { id: '2', name: 'Pat Kim', email: '' },
  { id: '3', name: 'Pat Kim', email: '' },
];

describe('findFriendForGuest', () => {
  it('matches by email, case-insensitively', () => {
    expect(findFriendForGuest(friends, { firstName: 'A', email: ' AMY@x.com ' })?.id).toBe('amy@x.com');
  });
  it('matches by the last ten phone digits', () => {
    expect(findFriendForGuest(friends, { firstName: 'S', phone: '+1 555.123.4567' })?.id).toBe('1');
  });
  it('matches an exact full name', () => {
    expect(findFriendForGuest(friends, { firstName: 'sarah', lastName: 'JONES' })?.id).toBe('1');
  });
  it('never matches on a first name alone', () => {
    expect(findFriendForGuest(friends, { firstName: 'Sarah', lastName: 'Smith' })).toBeNull();
  });
  it('refuses an ambiguous name', () => {
    expect(findFriendForGuest(friends, { firstName: 'Pat', lastName: 'Kim' })).toBeNull();
  });
});

describe('friendDataFromGuest', () => {
  it('needs a name', () => {
    expect(friendDataFromGuest({ email: 'a@b.c' })).toBeNull();
  });
  it('joins the address parts into one line', () => {
    const g = { firstName: 'Jo', lastName: 'Doe', address: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', email: 'jo@d.com', phone: '555' };
    expect(guestAddressLine(g)).toBe('1 Main St, Austin, TX 78701');
    expect(friendDataFromGuest(g)).toEqual({
      name: 'Jo Doe', email: 'jo@d.com', phone: '555',
      addresses: [{ label: 'Home', value: '1 Main St, Austin, TX 78701' }],
    });
  });
  it('leaves addresses empty with no address', () => {
    expect(friendDataFromGuest({ firstName: 'Jo' }).addresses).toEqual([]);
  });
});
