import { describe, it, expect } from 'vitest';
import {
  SEED_CATEGORIES, normalizeDreamVenue, toggleItem, editItem, removeItem, moveItem, addItem,
  renameCategory, removeCategory, moveCategory, addCategory, toggleCategory, dreamProgress,
} from './weddingDreamVenue';

describe('dream venue list', () => {
  it('starts with the seed list when nothing is stored, as a copy', () => {
    const cats = normalizeDreamVenue(undefined);
    expect(cats.map((c) => c.title)).toEqual(SEED_CATEGORIES.map((c) => c.title));
    expect(dreamProgress(cats)).toEqual({ done: 0, total: 20 });
    cats[0].items[0].done = true;
    expect(SEED_CATEGORIES[0].items[0].done).toBe(false);
  });

  it('keeps a stored list, empty included, and repairs ids', () => {
    expect(normalizeDreamVenue({ categories: [] })).toEqual([]);
    const cats = normalizeDreamVenue({ categories: [{ id: 'a', title: 'A', items: [{ id: 'x', title: 'X', done: true }, { id: 'x', title: 'Y' }, null] }, 'junk'] });
    expect(cats).toHaveLength(1);
    expect(cats[0].items.map((i) => i.title)).toEqual(['X', 'Y']);
    expect(cats[0].items[1].id).not.toBe('x');
    expect(cats[0].items[0]).toMatchObject({ done: true, detail: '' });
  });

  it('ticks, edits, moves and removes items', () => {
    let cats = normalizeDreamVenue(undefined);
    cats = toggleItem(cats, 'capacity', 'flow');
    cats = editItem(cats, 'capacity', 'flow', { title: 'Room flow' });
    expect(cats[1].items[1]).toMatchObject({ title: 'Room flow', done: true });
    cats = moveItem(cats, 'capacity', 'flow', -1);
    expect(cats[1].items[0].id).toBe('flow');
    expect(moveItem(cats, 'capacity', 'flow', -1)).toEqual(cats);
    cats = removeItem(cats, 'capacity', 'flow');
    expect(cats[1].items.map((i) => i.id)).toEqual(['guest-count', 'exclusivity']);
    const { cats: withNew, id } = addItem(cats, 'capacity', { title: 'Dance floor' }, 'n1');
    expect(id).toBe('n1');
    expect(withNew[1].items.at(-1)).toEqual({ id: 'n1', title: 'Dance floor', detail: '', done: false });
  });

  it('adds, renames, moves, ticks and removes categories', () => {
    let { cats } = addCategory(normalizeDreamVenue(undefined), 'Food', 'food');
    expect(cats.at(-1)).toEqual({ id: 'food', title: 'Food', items: [] });
    cats = renameCategory(cats, 'food', 'Food & drink');
    cats = moveCategory(cats, 'food', -1);
    expect(cats.at(-2).title).toBe('Food & drink');
    cats = toggleCategory(cats, 'service');
    expect(cats[0].items.every((i) => i.done)).toBe(true);
    cats = toggleCategory(cats, 'service');
    expect(cats[0].items.some((i) => i.done)).toBe(false);
    expect(removeCategory(cats, 'food').some((c) => c.id === 'food')).toBe(false);
  });
});
