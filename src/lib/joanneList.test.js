import { describe, it, expect } from 'vitest';
import {
  WANT, DONE, DEFAULT_KINDS, statusLabel, normalizeItem, normalizeList,
  addItem, updateItem, removeItem, setStatus, addKind, removeKind, kindUsage,
  counts, matches, visibleItems,
} from './joanneList';

const list = (items, kinds) => normalizeList({ items, ...(kinds ? { kinds } : {}) });

describe('statusLabel', () => {
  it('says what the kind actually is', () => {
    expect(statusLabel('Movie', WANT)).toBe('want to watch');
    expect(statusLabel('Movie', DONE)).toBe('watched');
    expect(statusLabel('Eat', WANT)).toBe('want to go');
    expect(statusLabel('Gift', DONE)).toBe('gave');
  });

  it('falls back for a kind of your own', () => {
    expect(statusLabel('Concert', WANT)).toBe('want to');
    expect(statusLabel('', DONE)).toBe('done');
  });
});

describe('normalizeItem', () => {
  it('fills every field and trims what was typed', () => {
    const i = normalizeItem({ title: '  Past Lives  ', kind: ' Movie ' });
    expect(i).toMatchObject({ title: 'Past Lives', kind: 'Movie', status: WANT, rating: 0, notes: '' });
    expect(i.id).toBeTruthy();
    expect(i.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps a rating inside its stars and an unknown status as still-to-do', () => {
    expect(normalizeItem({ rating: 9 }).rating).toBe(5);
    expect(normalizeItem({ rating: -2 }).rating).toBe(0);
    expect(normalizeItem({ rating: 'four' }).rating).toBe(0);
    expect(normalizeItem({ status: 'whenever' }).status).toBe(WANT);
  });
});

describe('normalizeList', () => {
  it('starts with the kinds the page offers', () => {
    expect(normalizeList(undefined).kinds).toEqual(DEFAULT_KINDS);
    expect(normalizeList(undefined).items).toEqual([]);
  });

  it('registers a kind an entry uses but the list has lost', () => {
    const l = list([{ title: 'Sleep No More', kind: 'Theatre' }], ['Movie']);
    expect(l.kinds).toEqual(['Movie', 'Theatre']);
  });

  it('drops an entry with nothing in it, and survives a malformed document', () => {
    expect(list([{ title: '   ' }]).items).toEqual([]);
    expect(normalizeList({ items: 'nope' }).items).toEqual([]);
    expect(normalizeList([{ title: 'Lilia', kind: 'Eat' }]).items).toHaveLength(1);
  });
});

describe('editing the list', () => {
  it('adds newest first, updates in place and removes', () => {
    let l = addItem(list([]), { title: 'Past Lives', kind: 'Movie' });
    l = addItem(l, { title: 'Lilia', kind: 'Eat' });
    expect(l.items.map((i) => i.title)).toEqual(['Lilia', 'Past Lives']);
    const id = l.items[1].id;
    l = updateItem(l, id, { notes: 'she mentioned it' });
    expect(l.items[1]).toMatchObject({ title: 'Past Lives', notes: 'she mentioned it' });
    l = removeItem(l, id);
    expect(l.items.map((i) => i.title)).toEqual(['Lilia']);
  });

  it('an edit cannot turn into a second entry', () => {
    const l = addItem(list([]), { id: 'a', title: 'Past Lives' });
    expect(updateItem(l, 'a', { id: 'b', title: 'Past Lives (2023)' }).items).toHaveLength(1);
  });
});

describe('ticking something off', () => {
  const l0 = addItem(list([]), { id: 'a', title: 'Past Lives', kind: 'Movie' });

  it('dates it the day you ticked it', () => {
    const l = setStatus(l0, 'a', DONE, '2026-09-17');
    expect(l.items[0]).toMatchObject({ status: DONE, date: '2026-09-17' });
  });

  it('keeps a date you typed yourself', () => {
    const typed = updateItem(l0, 'a', { date: '2026-08-01' });
    expect(setStatus(typed, 'a', DONE, '2026-09-17').items[0].date).toBe('2026-08-01');
  });

  it('clears the date and the rating when you put it back', () => {
    let l = setStatus(l0, 'a', DONE, '2026-09-17');
    l = updateItem(l, 'a', { rating: 4 });
    l = setStatus(l, 'a', WANT);
    expect(l.items[0]).toMatchObject({ status: WANT, date: '', rating: 0 });
  });

  it('ignores an id that isn\'t there', () => {
    expect(setStatus(l0, 'nope', DONE).items).toHaveLength(1);
  });
});

describe('kinds', () => {
  it('adds one, once, and counts what uses it', () => {
    let l = addKind(list([{ title: 'Lilia', kind: 'Eat' }]), 'Concert');
    expect(l.kinds).toContain('Concert');
    expect(addKind(l, ' concert ').kinds.filter((k) => k.toLowerCase() === 'concert')).toHaveLength(1);
    expect(kindUsage(l.items, 'eat')).toBe(1);
  });

  it('deleting one keeps its entries', () => {
    const l = removeKind(list([{ title: 'Lilia', kind: 'Eat' }, { title: 'Past Lives', kind: 'Movie' }]), 'Eat');
    expect(l.kinds).not.toContain('Eat');
    expect(l.items.map((i) => i.title)).toContain('Lilia');
    expect(l.items.find((i) => i.title === 'Lilia').kind).toBe('');
  });
});

describe('counts and search', () => {
  const l = list([
    { title: 'Past Lives', kind: 'Movie' },
    { title: 'The Holdovers', kind: 'Movie', status: DONE },
    { title: 'Lilia', kind: 'Eat', notes: 'book three weeks ahead' },
  ]);

  it('counts the list, the wants and each kind', () => {
    const c = counts(l.items);
    expect(c).toMatchObject({ all: 3, [WANT]: 2, [DONE]: 1 });
    expect(c.byKind).toMatchObject({ Movie: 2, Eat: 1 });
  });

  it('searches the title, the notes and the kind', () => {
    expect(matches(l.items[2], 'three weeks')).toBe(true);
    expect(matches(l.items[0], 'movie')).toBe(true);
    expect(matches(l.items[0], 'lilia')).toBe(false);
    expect(matches(l.items[0], '  ')).toBe(true);
  });
});

describe('what the page shows', () => {
  const l = list([
    { id: 'want-old', title: 'Anatomy of a Fall', kind: 'Movie', created: '2026-01-01' },
    { id: 'want-new', title: 'Past Lives', kind: 'Movie', created: '2026-09-01' },
    { id: 'done-old', title: 'Barbie', kind: 'Movie', status: DONE, date: '2026-02-01' },
    { id: 'done-new', title: 'The Holdovers', kind: 'Movie', status: DONE, date: '2026-08-01' },
    { id: 'eat', title: 'Lilia', kind: 'Eat', created: '2026-05-05' },
  ]);

  it('puts what is still to do first, newest first, with the done ones under', () => {
    expect(visibleItems(l).map((i) => i.id)).toEqual(['want-new', 'eat', 'want-old', 'done-new', 'done-old']);
  });

  it('filters to one kind', () => {
    expect(visibleItems(l, { kind: 'Movie' }).map((i) => i.id)).toEqual(['want-new', 'want-old', 'done-new', 'done-old']);
    expect(visibleItems(l, { kind: 'eat' })).toHaveLength(1);
  });

  it('filters to what is still to do, and searches', () => {
    expect(visibleItems(l, { status: WANT })).toHaveLength(3);
    expect(visibleItems(l, { query: 'past' }).map((i) => i.title)).toEqual(['Past Lives']);
  });
});
