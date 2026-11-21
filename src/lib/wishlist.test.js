import { describe, it, expect } from 'vitest';
import { cleanLink, cleanWish, cleanWishes, wishesOf, wishlistPeople, whoAmI, memberKeyByEmail, wishlistLink, MAX_WISHES } from './wishlist';

describe('cleanLink', () => {
  it('keeps web links, adding https:// to a bare one', () => {
    expect(cleanLink('https://shop.example.com/a?b=1')).toBe('https://shop.example.com/a?b=1');
    expect(cleanLink(' amazon.com/dp/123 ')).toBe('https://amazon.com/dp/123');
  });

  it('drops anything that is not a web address', () => {
    for (const bad of ['', 'javascript:alert(1)', 'data:text/html,hi', 'mailto:a@b.com', 'a nice scarf', 'scarf', 'x'.repeat(600)]) {
      expect(cleanLink(bad), bad).toBe('');
    }
  });
});

describe('cleanWishes', () => {
  it('trims, drops blanks, and keeps ids unique', () => {
    const out = cleanWishes([
      { id: 'a1', text: '  Wool   socks ', link: 'example.com' },
      { id: 'a1', text: 'A book' },
      { id: 'b2', text: '   ' },
      null,
      'nope',
    ]);
    expect(out.map((w) => w.text)).toEqual(['Wool socks', 'A book']);
    expect(out[0]).toEqual({ id: 'a1', text: 'Wool socks', link: 'https://example.com/' });
    expect(out[1].id).not.toBe('a1');
    expect(out[1].link).toBe('');
  });

  it('caps the length of a wish and of the list', () => {
    expect(cleanWish({ text: 'x'.repeat(500) }).text).toHaveLength(140);
    expect(cleanWishes(Array.from({ length: 80 }, (_, i) => ({ text: `wish ${i}` })))).toHaveLength(MAX_WISHES);
    expect(cleanWishes('nope')).toEqual([]);
  });
});

const event = {
  members: {
    dan: { name: 'Dan', email: 'Dan@Example.com', rsvp: 'yes' },
    bob: { name: 'Bob', rsvp: 'pending' },
    eve: { name: 'Eve', rsvp: 'no' },
    zed: { name: 'Zed', rsvp: 'no' },
    anon: { email: 'x@y.com' },
    junk: 'oops',
  },
  wishlists: {
    bob: { items: [{ id: 'w1', text: 'Mittens' }] },
    zed: { items: [{ id: 'w2', text: 'Skates' }] },
    gone: { items: [{ id: 'w3', text: 'Left the event' }] },
  },
};

describe('wishlistPeople', () => {
  it('lists named guests who are coming, plus anyone who already wrote a list', () => {
    const people = wishlistPeople(event);
    expect(people.map((p) => p.key)).toEqual(['bob', 'dan', 'zed']);
    expect(people[0].wishes).toEqual([{ id: 'w1', text: 'Mittens', link: '' }]);
    expect(people[1].wishes).toEqual([]);
  });

  it('copes with an event that has neither guests nor lists', () => {
    expect(wishlistPeople({})).toEqual([]);
    expect(wishesOf(null, 'dan')).toEqual([]);
  });
});

describe('recognising the visitor', () => {
  const people = wishlistPeople(event);

  it('takes the first candidate who is on the page', () => {
    expect(whoAmI(people, ['nobody', '', 'bob', 'dan'])).toBe('bob');
    expect(whoAmI(people, [null, 'eve'])).toBeNull();
    expect(whoAmI(people)).toBeNull();
  });

  it('finds a signed-in guest by their email', () => {
    expect(memberKeyByEmail(event, 'dan@example.com')).toBe('dan');
    expect(memberKeyByEmail(event, 'nobody@example.com')).toBeNull();
    expect(memberKeyByEmail(event, '')).toBeNull();
  });
});

describe('wishlistLink', () => {
  it('points at the page, optionally as one guest', () => {
    expect(wishlistLink('ev1')).toBe('https://rally-seven-theta.vercel.app/wishlist/ev1');
    expect(wishlistLink('ev1', 'a b')).toBe('https://rally-seven-theta.vercel.app/wishlist/ev1?me=a%20b');
  });
});
