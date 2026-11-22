import { describe, it, expect } from 'vitest';
import { giftPeople, extraGiftPeople, isAlwaysGiftPerson, giftRelation, findFriend, giftIdeasOf, myPick, linkify } from './gifts';

const friends = [
  { id: 'f1', name: 'Sally Baldauf', email: 'sally@x.com', giftIdeas: ['  Garden gloves ', '', 'Tea'] },
  { id: 'f2', name: 'Brian Baldauf', email: '' },
  { id: 'f3', name: 'Sam Lee', email: 'sam1@x.com' },
  { id: 'f4', name: 'Sam Lee', email: 'sam2@x.com' },
  null,
];

describe('giftPeople', () => {
  it('always leads with Joanne, Mom and Dad', () => {
    expect(giftPeople(undefined)).toEqual(['Joanne', 'Sally Baldauf', 'Brian Baldauf']);
    expect(giftPeople([])).toEqual(['Joanne', 'Sally Baldauf', 'Brian Baldauf']);
    expect(giftRelation('sally  baldauf')).toBe('Mom');
    expect(giftRelation('Brian Baldauf')).toBe('Dad');
    expect(giftRelation('Joanne')).toBe('');
  });

  it('adds the saved extras after them, tidied, without repeating anyone', () => {
    expect(giftPeople(['  Mom ', 'mom', '', null, 'brian baldauf', 'Uncle  Bob']))
      .toEqual(['Joanne', 'Sally Baldauf', 'Brian Baldauf', 'Mom', 'Uncle Bob']);
    expect(extraGiftPeople(['Sally Baldauf', 'Uncle Bob', 'Joanne'])).toEqual(['Uncle Bob']);
    expect(isAlwaysGiftPerson('JOANNE')).toBe(true);
    expect(isAlwaysGiftPerson('Uncle Bob')).toBe(false);
  });
});

describe('findFriend', () => {
  it('matches by email first, then by a name only one contact has', () => {
    expect(findFriend(friends, { name: 'Someone else', email: 'SALLY@x.com' }).id).toBe('f1');
    expect(findFriend(friends, { name: 'brian  baldauf' }).id).toBe('f2');
    expect(findFriend(friends, { name: 'Sam Lee' })).toBeNull();
    expect(findFriend(friends, { name: 'Sam Lee', email: 'sam2@x.com' }).id).toBe('f4');
    expect(findFriend(friends, { name: 'Nobody' })).toBeNull();
    expect(findFriend(null, { name: 'Sally Baldauf' })).toBeNull();
  });

  it('lets a one-word name find the only contact with that first name', () => {
    const list = [...friends, { id: 'j', name: 'Joanne (Joo Yeon) Seo' }];
    expect(findFriend(list, { name: 'Joanne' }).id).toBe('j');
    expect(findFriend(list, { name: 'Sam' })).toBeNull(); // two Sams
    expect(findFriend([...list, { id: 'j2', name: 'Joanne' }], { name: 'joanne' }).id).toBe('j2'); // exact wins
    expect(findFriend(list, { name: 'Sally Smith' })).toBeNull();
  });
});

describe('giftIdeasOf', () => {
  it('gives the saved ideas as clean lines', () => {
    expect(giftIdeasOf(friends[0])).toEqual(['Garden gloves', 'Tea']);
    expect(giftIdeasOf(friends[1])).toEqual([]);
    expect(giftIdeasOf(null)).toEqual([]);
  });
});

describe('myPick', () => {
  const record = { pairs: [
    { giver: { key: 'amy', name: 'Amy', email: 'amy@x.com' }, receiver: { key: 'dan', name: 'Dan' } },
    { giver: { key: 'dan', name: 'Dan', email: 'dan@x.com' }, receiver: { key: 'milan', name: 'Milan Sova', email: 'milan@x.com' } },
  ] };

  it('finds who I drew, by my key or my email', () => {
    expect(myPick(record, { uid: 'dan' })).toEqual({ key: 'milan', name: 'Milan Sova', email: 'milan@x.com' });
    expect(myPick(record, { uid: 'new-uid', email: 'DAN@x.com' }).name).toBe('Milan Sova');
  });

  it('is null with no draw, or when I am not in it', () => {
    expect(myPick(null, { uid: 'dan' })).toBeNull();
    expect(myPick({ pairs: [] }, { uid: 'dan' })).toBeNull();
    expect(myPick(record, { uid: 'zed', email: 'zed@x.com' })).toBeNull();
    expect(myPick(record, {})).toBeNull();
  });
});

describe('linkify', () => {
  it('turns web addresses into links and leaves the rest as text', () => {
    expect(linkify('A mug: https://shop.example/mug?x=1. Or (https://b.example/a), see?')).toEqual([
      { text: 'A mug: ' }, { text: 'https://shop.example/mug?x=1', href: 'https://shop.example/mug?x=1' },
      { text: '. Or (' }, { text: 'https://b.example/a', href: 'https://b.example/a' }, { text: '), see?' },
    ]);
    expect(linkify('javascript:alert(1) ftp://x')).toEqual([{ text: 'javascript:alert(1) ftp://x' }]);
    expect(linkify('')).toEqual([]);
  });
});
