import { describe, it, expect } from 'vitest';
import { partnerMap, partyUnits, moveUnit, orderFromUnits, partyPositions, partyKey, keepCouplesTogether, rowOutlines, groupPartiesTogether, partnersFollowGroup, partySuggestions } from './weddingParty';

const friendsById = new Map([
  ['fa', { id: 'fa', linkedTo: 'fb' }],   // Ann ↔ Bob, both ways
  ['fb', { id: 'fb', linkedTo: 'fa' }],
  ['fc', { id: 'fc', linkedTo: 'fd' }],   // Cat → Dan, Dan points nowhere: still a couple
  ['fd', { id: 'fd' }],
  ['fe', { id: 'fe', linkedTo: 'fa' }],   // Eve → Ann, but Ann is with Bob: no couple
]);
const g = (id, first, extra = {}) => ({ id, firstName: first, lastName: 'X', friendId: `f${id}`, ...extra });
const ann = g('a', 'Ann'); const bob = g('b', 'Bob'); const cat = g('c', 'Cat'); const dan = g('d', 'Dan'); const eve = g('e', 'Eve');

describe('partnerMap', () => {
  it('pairs mutual and one-way Comes With links, never a third person', () => {
    const m = partnerMap([ann, bob, cat, dan, eve], friendsById);
    expect(m.get('a')).toBe('b');
    expect(m.get('b')).toBe('a');
    expect(m.get('c')).toBe('d');
    expect(m.get('d')).toBe('c');
    expect(m.has('e')).toBe(false);
  });
});

describe('partyUnits', () => {
  const partners = partnerMap([ann, bob, cat, dan, eve], friendsById);
  it('orders by partyOrder then name, keeping couples side by side', () => {
    const members = [{ ...eve, partyOrder: 0 }, { ...bob, partyOrder: 5 }, cat, { ...ann, partyOrder: 9 }];
    const units = partyUnits(members, partners);
    expect(units.map((u) => u.map((x) => x.id))).toEqual([['e'], ['b', 'a'], ['c']]);
  });
  it('a partner outside the group is not pulled in', () => {
    expect(partyUnits([ann, cat], partners).map((u) => u.map((x) => x.id))).toEqual([['a'], ['c']]);
  });
});

describe('moveUnit / orderFromUnits', () => {
  const units = [[ann, bob], [cat], [eve]];
  it('moves a whole couple and numbers everyone in order', () => {
    const next = moveUnit(units, 0, 1);
    expect(next.map((u) => u[0].id)).toEqual(['c', 'a', 'e']);
    expect([...orderFromUnits(next)]).toEqual([['c', 0], ['a', 1], ['b', 2], ['e', 3]]);
  });
  it('ignores moves off either end', () => {
    expect(moveUnit(units, 0, -1)).toBe(units);
    expect(moveUnit(units, 2, 1)).toBe(units);
  });
});

describe('partyPositions', () => {
  it('positions each guest within their own group, case-insensitively', () => {
    const partners = partnerMap([ann, bob], friendsById);
    const pos = partyPositions([
      { ...cat, party: 'Smiths', partyOrder: 1 },
      { ...ann, party: 'smiths ', partyOrder: 0 },
      { ...bob, party: 'Smiths' },
      { ...eve, party: 'Other' },
      { ...dan },
    ], partners);
    expect(pos.get('a')).toBe(0);
    expect(pos.get('b')).toBe(1);
    expect(pos.get('c')).toBe(2);
    expect(pos.get('e')).toBe(0);
    expect(pos.has('d')).toBe(false);
    expect(partyKey('  Smiths ')).toBe('smiths');
  });
});

describe('keepCouplesTogether / rowOutlines', () => {
  const partners = partnerMap([ann, bob, cat, dan, eve], friendsById);
  it('pulls the second half of a couple up beside the first', () => {
    expect(keepCouplesTogether([ann, cat, eve, bob, dan], partners).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('leaves a partner filtered out of the rows alone', () => {
    expect(keepCouplesTogether([ann, cat, eve], partners).map((r) => r.id)).toEqual(['a', 'c', 'e']);
  });
  it('with sameGroupOnly, a partner in another group stays put', () => {
    const rows = [{ ...ann, party: 'Smith' }, { ...cat, party: 'Smith' }, { ...bob, party: 'Jones' }];
    expect(keepCouplesTogether(rows, partners, { sameGroupOnly: true }).map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });
  it('boxes runs of a group and adjacent couples', () => {
    const rows = [{ ...ann, party: 'Smith' }, { ...bob, party: 'smith ' }, { ...eve, party: 'Smith' }, { ...cat, party: 'Lone' }, dan];
    const o = rowOutlines(rows, partners);
    expect(o.get('a')).toEqual({ group: 'top', couple: 'top' });
    expect(o.get('b')).toEqual({ group: 'mid', couple: 'bottom' });
    expect(o.get('e')).toEqual({ group: 'bottom' });
    // A one-person run gets no group box; Cat and Dan are still a couple.
    expect(o.get('c')).toEqual({ couple: 'top' });
    expect(o.get('d')).toEqual({ couple: 'bottom' });
  });
});

describe('groupPartiesTogether', () => {
  const g = (id, party, extra = {}) => ({ id, firstName: id, party, ...extra });

  it('pulls a group split by the sort into one block where its first member was', () => {
    const rows = [g('a', 'Smiths'), g('x', ''), g('b', 'Jones'), g('c', 'smiths '), g('y', ''), g('d', 'Jones')];
    expect(groupPartiesTogether(rows, new Map()).map((r) => r.id)).toEqual(['a', 'c', 'x', 'b', 'd', 'y']);
  });

  it('orders a block by partyOrder and keeps couples side by side', () => {
    const rows = [g('a', 'S', { partyOrder: 2 }), g('b', 'S', { partyOrder: 0 }), g('c', 'S', { partyOrder: 1 })];
    const partners = new Map([['b', 'a'], ['a', 'b']]);
    expect(groupPartiesTogether(rows, partners).map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('pulls an ungrouped couple together but leaves a partner in another group in theirs', () => {
    const rows = [g('a', ''), g('x', 'S'), g('b', ''), g('c', 'T')];
    const partners = new Map([['a', 'b'], ['b', 'a'], ['x', 'c'], ['c', 'x']]);
    expect(groupPartiesTogether(rows, partners).map((r) => r.id)).toEqual(['a', 'b', 'x', 'c']);
  });
});

describe('groupPartiesTogether with canPair', () => {
  it('leaves an ungrouped couple apart when canPair says no, but still blocks groups', () => {
    const g = (id, party) => ({ id, firstName: id, party });
    const rows = [g('a', ''), g('x', 'S'), g('b', ''), g('y', 'S')];
    const partners = new Map([['a', 'b'], ['b', 'a']]);
    expect(groupPartiesTogether(rows, partners, { canPair: () => false }).map((r) => r.id)).toEqual(['a', 'x', 'y', 'b']);
  });
});

describe('partnersFollowGroup', () => {
  const friends = new Map([
    ['fa', { id: 'fa', name: 'Ann Lee', linkedTo: 'fb' }],
    ['fb', { id: 'fb', name: 'Ben Lee' }],
    ['fc', { id: 'fc', name: 'Cat Day', linkedTo: 'fd' }],
    ['fd', { id: 'fd', name: 'Dov Day', linkedTo: 'fc' }],
  ]);
  const mk = (f) => ({ id: `new-${f.id}`, firstName: f.name.split(' ')[0], lastName: f.name.split(' ')[1], friendId: f.id });

  it('moves a partner with no group into the new group', () => {
    const prev = [{ id: 'a', friendId: 'fa', party: '' }, { id: 'b', friendId: 'fb', party: '' }];
    const next = [{ id: 'a', friendId: 'fa', party: 'Lees' }, prev[1]];
    const r = partnersFollowGroup(prev, next, friends, { makeGuest: mk });
    expect(r.list.find((g) => g.id === 'b').party).toBe('Lees');
    expect(r.moved).toHaveLength(1);
  });

  it('works when it is the pointed-at friend who moves', () => {
    const prev = [{ id: 'a', friendId: 'fa', party: 'Old' }, { id: 'b', friendId: 'fb', party: 'Old' }];
    const next = [prev[0], { id: 'b', friendId: 'fb', party: 'New' }];
    const r = partnersFollowGroup(prev, next, friends, { makeGuest: mk });
    expect(r.list.find((g) => g.id === 'a').party).toBe('New');
    expect(r.list.find((g) => g.id === 'a').partyOrder).toBe(null);
  });

  it('follows typing: a partner in the old (half-typed) group follows', () => {
    const prev = [{ id: 'c', friendId: 'fc', party: 'Da' }, { id: 'd', friendId: 'fd', party: 'Da' }];
    const next = [{ id: 'c', friendId: 'fc', party: 'Days' }, prev[1]];
    expect(partnersFollowGroup(prev, next, friends).list[1].party).toBe('Days');
  });

  it('leaves a partner placed in some other group alone', () => {
    const prev = [{ id: 'c', friendId: 'fc', party: '' }, { id: 'd', friendId: 'fd', party: 'Work' }];
    const next = [{ id: 'c', friendId: 'fc', party: 'Days' }, prev[1]];
    const r = partnersFollowGroup(prev, next, friends);
    expect(r.list[1].party).toBe('Work');
    expect(r.moved).toHaveLength(0);
  });

  it('adds a partner who is not on the list yet, in the group', () => {
    const prev = [{ id: 'a', friendId: 'fa', party: '' }];
    const next = [{ id: 'a', friendId: 'fa', party: 'Lees' }];
    const r = partnersFollowGroup(prev, next, friends, { makeGuest: mk });
    expect(r.list).toHaveLength(2);
    expect(r.list[1]).toMatchObject({ friendId: 'fb', party: 'Lees', partyOrder: null });
    expect(r.added).toEqual(['Ben Lee']);
  });

  it('does not add anyone when the group is cleared, and leaves the list alone when no group changed', () => {
    const prev = [{ id: 'a', friendId: 'fa', party: 'Lees' }];
    expect(partnersFollowGroup(prev, [{ ...prev[0], party: '' }], friends, { makeGuest: mk }).list).toHaveLength(1);
    const same = [{ ...prev[0], city: 'Rye' }];
    expect(partnersFollowGroup(prev, same, friends, { makeGuest: mk }).list).toEqual(same);
  });

  it('clears the partner too when they were in the old group', () => {
    const prev = [{ id: 'a', friendId: 'fa', party: 'Lees' }, { id: 'b', friendId: 'fb', party: 'Lees' }];
    const next = [{ ...prev[0], party: '' }, prev[1]];
    expect(partnersFollowGroup(prev, next, friends).list[1].party).toBe('');
  });

  it('moves both halves once when the two are moved together', () => {
    const prev = [{ id: 'a', friendId: 'fa', party: '' }, { id: 'b', friendId: 'fb', party: '' }];
    const next = [{ ...prev[0], party: 'X' }, { ...prev[1], party: 'X' }];
    const r = partnersFollowGroup(prev, next, friends);
    expect(r.moved).toHaveLength(0);
  });
});

describe('partySuggestions', () => {
  const parties = ['College', 'Smith family', 'Work', 'The Smiths'];
  it('offers every group before anything is typed', () => {
    expect(partySuggestions(parties, '  ')).toEqual({ matches: parties, exact: '', canCreate: false });
  });
  it('narrows to groups containing the text, prefix matches first', () => {
    expect(partySuggestions(parties, 'smi').matches).toEqual(['Smith family', 'The Smiths']);
  });
  it('recognises an existing group whatever the case, and offers to create a new one', () => {
    expect(partySuggestions(parties, 'smith FAMILY ')).toMatchObject({ exact: 'Smith family', canCreate: false });
    expect(partySuggestions(parties, 'Book club')).toEqual({ matches: [], exact: '', canCreate: true });
  });
});
