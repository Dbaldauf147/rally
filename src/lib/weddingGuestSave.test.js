import { describe, it, expect } from 'vitest';
import * as perGuest from './weddingGuestSave';
import { mergeGuestList, guestListChanges, checkRemovals, GuestListGuardError } from './weddingGuestSave';

const g = (id, extra = {}) => ({ id, firstName: id.toUpperCase(), ...extra });
const stored = [g('a'), g('b'), g('c')];

describe('mergeGuestList', () => {
  it('writes next as it is when nothing else touched the list', () => {
    const next = [g('c'), g('a', { status: 'Confirmed' }), g('b')];
    expect(mergeGuestList(stored, next, stored)).toEqual({ list: next, removed: [] });
  });

  it('a page that never loaded the list adds its guest instead of replacing everyone', () => {
    const { list, removed } = mergeGuestList([], [g('new')], stored);
    expect(list.map((x) => x.id)).toEqual(['a', 'b', 'c', 'new']);
    expect(removed).toEqual([]);
  });

  it('an out-of-date tab keeps the guests added elsewhere since it loaded', () => {
    const base = [g('a'), g('b')];
    const next = [g('a', { status: 'Confirmed' }), g('b')];
    const current = [g('a'), g('b'), g('c'), g('d')];
    const { list } = mergeGuestList(base, next, current);
    expect(list).toEqual([g('a', { status: 'Confirmed' }), g('b'), g('c'), g('d')]);
  });

  it('merges edits to different fields of the same guest', () => {
    const base = [g('a', { city: 'Troy', status: 'Pending' })];
    const next = [g('a', { city: 'Troy', status: 'Confirmed' })];
    const current = [g('a', { city: 'Albany', status: 'Pending' })];
    expect(mergeGuestList(base, next, current).list).toEqual([g('a', { city: 'Albany', status: 'Confirmed' })]);
  });

  it('drops a field the page removed', () => {
    const base = [g('a', { partyOrder: 2 }), g('b')];
    const next = [g('a'), g('b')];
    const current = [g('a', { partyOrder: 2 }), g('b'), g('c')];
    expect(mergeGuestList(base, next, current).list[0]).toEqual(g('a'));
  });

  it('removes only the guests the page removed itself', () => {
    const base = [g('a'), g('b')];
    const current = [g('a'), g('b'), g('c')];
    const { list, removed } = mergeGuestList(base, [g('a')], current);
    expect(list.map((x) => x.id)).toEqual(['a', 'c']);
    expect(removed).toEqual(['b']);
  });

  it('does not bring back a guest deleted elsewhere, or add one twice', () => {
    const base = [g('a'), g('b')];
    const next = [g('a'), g('b', { status: 'Confirmed' }), g('n')];
    const current = [g('a'), g('n')];
    expect(mergeGuestList(base, next, current).list.map((x) => x.id)).toEqual(['a', 'n']);
  });

  it('leaves a stored row with no id alone', () => {
    const odd = { firstName: 'No', lastName: 'Id' };
    const { list } = mergeGuestList([g('a')], [g('a', { status: 'Confirmed' })], [g('a'), odd, g('b')]);
    expect(list).toEqual([g('a', { status: 'Confirmed' }), odd, g('b')]);
  });

  it('treats a missing stored list as empty', () => {
    expect(mergeGuestList([], [g('a')], undefined)).toEqual({ list: [g('a')], removed: [] });
  });
});

describe('guestListChanges', () => {
  it('names what was added, removed and edited', () => {
    const ch = guestListChanges([g('a'), g('b')], [g('a', { status: 'Confirmed' }), g('c')]);
    expect(ch.added).toEqual([g('c')]);
    expect(ch.removed).toEqual(['b']);
    expect([...ch.edited.keys()]).toEqual(['a']);
  });
});

describe('checkRemovals', () => {
  it('lets through the removals the caller asked for', () => {
    expect(() => checkRemovals(['a', 'b'], ['a', 'b', 'z'])).not.toThrow();
    expect(() => checkRemovals([], [])).not.toThrow();
  });

  it('stops a save that drops guests nobody asked to delete', () => {
    expect(() => checkRemovals(['a', 'b'], ['a'])).toThrow(GuestListGuardError);
    try { checkRemovals(['a', 'b'], []); } catch (err) {
      expect(err.unexpected).toEqual(['a', 'b']);
      expect(err.message).toMatch(/removed 2 guests/);
    }
  });
});

describe('one document per guest', () => {
  const { planGuestDocWrites, touchedIds, saveSteps, migrationBlocker, sameGuests, inListOrder } = perGuest;
  const cur = (...guests) => new Map(guests.map((x) => [x.id, x]));

  it('writes only the guests a save changed', () => {
    const base = [g('a'), g('b'), g('c')];
    const next = [g('a', { status: 'Confirmed' }), g('c'), g('n')];
    expect(touchedIds(base, next).sort()).toEqual(['a', 'b', 'n']);
    expect(planGuestDocWrites(base, next, cur(g('a'), g('b')))).toEqual({ sets: [g('n'), g('a', { status: 'Confirmed' })], deletes: ['b'] });
  });

  it('applies an edit to the stored guest field by field, and drops removed fields', () => {
    const base = [g('a', { city: 'Troy', partyOrder: 2 })];
    const next = [g('a', { city: 'Troy', status: 'Confirmed' })];
    const stored = g('a', { city: 'Albany', partyOrder: 2, phone: '555' });
    expect(planGuestDocWrites(base, next, cur(stored)).sets).toEqual([g('a', { city: 'Albany', phone: '555', status: 'Confirmed' })]);
  });

  it('does not bring back a guest deleted elsewhere, or delete one already gone', () => {
    const base = [g('a'), g('b')];
    expect(planGuestDocWrites(base, [g('a', { status: 'Confirmed' })], cur())).toEqual({ sets: [], deletes: [] });
  });

  it('refuses a new guest with no id', () => {
    expect(() => planGuestDocWrites([], [{ firstName: 'No id' }], cur())).not.toThrow(); // unmatched rows aren't "added"
    expect(migrationBlocker([{ firstName: 'No', lastName: 'Id' }])).toMatch(/No Id.*no usable id/);
  });

  it('splits a big save into steps that end at the list asked for', () => {
    const base = Array.from({ length: 10 }, (_, i) => g(`g${i}`));
    const next = [...base.slice(2).map((x) => ({ ...x, group: 'A' })), g('new')];
    const steps = saveSteps(base, next, 4);
    expect(steps).toHaveLength(3);
    expect(steps.at(-1)).toEqual(next);
    let prev = base;
    for (const s of steps) { expect(touchedIds(prev, s).length).toBeLessThanOrEqual(4); prev = s; }
    expect(saveSteps(base, [g('g0', { x: 1 }), ...base.slice(1)])).toHaveLength(1);
  });

  it('says why a list cannot move, or that it can', () => {
    expect(migrationBlocker([g('a'), g('b')])).toBe('');
    expect(migrationBlocker([g('a'), g('a')])).toMatch(/share the id a/);
    expect(migrationBlocker([{ id: 'x/y' }])).toMatch(/no usable id/);
  });

  it('compares lists whatever the order of guests or fields', () => {
    expect(sameGuests([{ id: 'a', x: 1, y: 2 }, g('b')], [g('b'), { y: 2, id: 'a', x: 1 }])).toBe(true);
    expect(sameGuests([g('a')], [g('a', { status: 'Confirmed' })])).toBe(false);
    expect(sameGuests([g('a')], [g('a'), g('b')])).toBe(false);
  });

  it('keeps the list order for guest documents', () => {
    expect(inListOrder([g('c'), g('z'), g('a'), g('b')], [g('a'), g('b'), g('c')]).map((x) => x.id)).toEqual(['a', 'b', 'c', 'z']);
  });
});
