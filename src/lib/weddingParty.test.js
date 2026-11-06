import { describe, it, expect } from 'vitest';
import { partnerMap, partyUnits, moveUnit, orderFromUnits, partyPositions, partyKey, keepCouplesTogether, rowOutlines } from './weddingParty';

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
