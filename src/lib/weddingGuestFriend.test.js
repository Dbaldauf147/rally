import { describe, it, expect } from 'vitest';
import { findFriendForGuest, friendDataFromGuest, guestAddressLine, planGuestFriendSync } from './weddingGuestFriend';

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

describe('planGuestFriendSync', () => {
  const g = (id, first, last, extra = {}) => ({ id, firstName: first, lastName: last, ...extra });

  it('links guests who are already friends and creates the rest', () => {
    const { creates, links } = planGuestFriendSync(
      [g('a', 'Amy', 'Lee', { email: 'AMY@x.com' }), g('b', 'Ben', 'Ode', { phone: '212-555-0100' })],
      friends,
    );
    expect(links.a).toBe('amy@x.com');
    expect(creates).toHaveLength(1);
    expect(creates[0].data).toMatchObject({ name: 'Ben Ode', phone: '212-555-0100' });
    expect(links.b).toBe(creates[0].tmpId);
  });

  it('skips linked, hidden and nameless guests, and dead links', () => {
    const { creates, links } = planGuestFriendSync([
      g('a', 'Amy', 'Lee', { friendId: 'amy@x.com' }),
      g('b', 'Ben', 'Ode', { category: 'Hide' }),
      g('c', '', '', { email: 'nobody@x.com' }),
      g('d', 'Dot', 'Ray', { friendId: 'deleted-friend' }),
    ], friends);
    expect(creates).toEqual([]);
    expect(links).toEqual({});
  });

  it('gives two guests who are the same person one new friend', () => {
    const { creates, links } = planGuestFriendSync([
      g('a', 'Cy', 'Ng', { email: 'cy@x.com' }),
      g('b', 'Cyrus', 'Ng', { email: 'CY@x.com' }),
      g('c', 'Jo', 'Park'),
      g('d', 'Jo', 'Park'),
    ], []);
    expect(creates).toHaveLength(2);
    expect(links.a).toBe(links.b);
    expect(links.c).toBe(links.d);
    expect(links.a).not.toBe(links.c);
  });

  it('can be limited to some guests', () => {
    const { creates, links } = planGuestFriendSync([g('a', 'Al', 'Bo'), g('b', 'Cal', 'Dee')], [], { onlyIds: ['b'] });
    expect(creates.map((c) => c.data.name)).toEqual(['Cal Dee']);
    expect(Object.keys(links)).toEqual(['b']);
  });
});
