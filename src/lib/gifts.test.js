import { describe, it, expect } from 'vitest';
import { cleanIdeas, giftRows, canEditGifts, linkify, MAX_IDEAS } from './gifts';

const event = {
  createdBy: 'dan',
  members: {
    dan: { role: 'owner', name: 'Dan' },
    amy: { name: 'Amy', role: 'editor' },
    zed: { name: '', email: 'zed@x.com' },
    bob: { name: 'Bob' },
    dead: null,
  },
  gifts: {
    amy: { ideas: 'Books\r\nA scarf  \n', updatedAt: '2026-11-16T12:00:00Z', updatedBy: 'Amy' },
    bob: 'junk',
    gone: { ideas: 'left the event' },
  },
};

describe('cleanIdeas', () => {
  it('tidies line ends and caps the length', () => {
    expect(cleanIdeas('  Books\r\nA scarf  \n\n')).toBe('Books\nA scarf');
    expect(cleanIdeas(null)).toBe('');
    expect(cleanIdeas('x'.repeat(MAX_IDEAS + 50))).toHaveLength(MAX_IDEAS);
  });
});

describe('giftRows', () => {
  it('lists every guest by name with their list, ignoring junk and people who left', () => {
    expect(giftRows(event)).toEqual([
      { key: 'amy', name: 'Amy', ideas: 'Books\nA scarf', updatedAt: '2026-11-16T12:00:00Z', updatedBy: 'Amy' },
      { key: 'bob', name: 'Bob', ideas: '', updatedAt: '', updatedBy: '' },
      { key: 'dan', name: 'Dan', ideas: '', updatedAt: '', updatedBy: '' },
      { key: 'zed', name: 'zed@x.com', ideas: '', updatedAt: '', updatedBy: '' },
    ]);
    expect(giftRows({})).toEqual([]);
  });
});

describe('canEditGifts', () => {
  it('lets a guest edit their own, and the organizer or an editor edit anyone’s', () => {
    expect(canEditGifts(event, 'bob', 'bob')).toBe(true);
    expect(canEditGifts(event, 'bob', 'amy')).toBe(false);
    expect(canEditGifts(event, 'dan', 'bob')).toBe(true);
    expect(canEditGifts(event, 'amy', 'bob')).toBe(true);
    expect(canEditGifts(event, '', 'bob')).toBe(false);
    expect(canEditGifts({ createdBy: 'x', members: {} }, 'x', 'bob')).toBe(true);
  });
});

describe('linkify', () => {
  it('turns web addresses into links and leaves the rest as text', () => {
    expect(linkify('A mug: https://shop.example/mug?x=1. Or (https://b.example/a), see?')).toEqual([
      { text: 'A mug: ' }, { text: 'https://shop.example/mug?x=1', href: 'https://shop.example/mug?x=1' },
      { text: '. Or (' }, { text: 'https://b.example/a', href: 'https://b.example/a' }, { text: '), see?' },
    ]);
    expect(linkify('no links here')).toEqual([{ text: 'no links here' }]);
    expect(linkify('javascript:alert(1) ftp://x')).toEqual([{ text: 'javascript:alert(1) ftp://x' }]);
    expect(linkify('')).toEqual([]);
  });
});
