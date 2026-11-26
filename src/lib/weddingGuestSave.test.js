import { describe, it, expect } from 'vitest';
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
