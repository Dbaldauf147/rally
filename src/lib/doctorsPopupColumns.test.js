import { describe, it, expect } from 'vitest';
import {
  normalizePrefs, shownColumns, toggleColumn, setColumnWidth, cycleSort, sortEntries,
  DEFAULT_SHOWN, MIN_WIDTH, MAX_WIDTH, POPUP_COLUMNS,
} from './doctorsPopupColumns.js';

// Preferences saved by this version, which has offered every column.
const known = POPUP_COLUMNS.map((c) => c.key);

describe('popup column preferences', () => {
  it('starts with the columns the table has always shown', () => {
    expect(shownColumns(null).map((c) => c.key)).toEqual(DEFAULT_SHOWN);
  });

  it('drops unknown columns, clamps widths, forgets a sort on a missing column', () => {
    const p = normalizePrefs({ known, shown: ['doctor', 'gone', 'doctor', 'phone'], widths: { doctor: 5, notes: 5000, gone: 100 }, sort: { key: 'gone', dir: 'asc' } });
    expect(p.shown).toEqual(['doctor', 'phone']);
    expect(p.widths).toEqual({ doctor: MIN_WIDTH, notes: MAX_WIDTH });
    expect(p.sort).toBe(null);
  });

  it('never ends up with no columns', () => {
    expect(normalizePrefs({ shown: [] }).shown).toEqual(DEFAULT_SHOWN);
    const one = { known, shown: ['doctor'] };
    expect(toggleColumn(one, 'doctor').shown).toEqual(['doctor']);
  });

  it('shows and hides a column in catalogue order, and drops a sort on one it hides', () => {
    let p = toggleColumn(null, 'phone');
    expect(shownColumns(p).map((c) => c.key)).toContain('phone');
    // Catalogue order, not the order they were switched on.
    expect(shownColumns(toggleColumn(null, 'place')).map((c) => c.key).slice(0, 3)).toEqual(['doctor', 'place', 'issue']);
    p = { ...p, sort: { key: 'phone', dir: 'asc' } };
    p = toggleColumn(p, 'phone');
    expect(p.shown).not.toContain('phone');
    expect(p.sort).toBe(null);
  });

  it('shows a column added since the preferences were saved, once', () => {
    // Saved before Images existed: it appears.
    const before = normalizePrefs({ shown: ['doctor', 'notes'] });
    expect(before.shown).toEqual(['doctor', 'notes', 'images']);
    // Hidden after that, it stays hidden.
    const hidden = toggleColumn(before, 'images');
    expect(normalizePrefs(JSON.parse(JSON.stringify(hidden))).shown).toEqual(['doctor', 'notes']);
    // A brand-new table shows it with the rest of the defaults.
    expect(normalizePrefs(null).shown).toContain('images');
  });

  it('sorts by how many pictures a record has', () => {
    const rows = [{ id: 'a', n: 0 }, { id: 'b', n: 3 }, { id: 'c', n: 1 }];
    expect(sortEntries(rows, { key: 'images', dir: 'desc' }, (e) => e.n).map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('remembers a dragged width', () => {
    const p = setColumnWidth(null, 'issue', 412.6);
    expect(shownColumns(p).find((c) => c.key === 'issue').width).toBe(413);
  });

  it('cycles a header through ascending, descending and off', () => {
    let s = cycleSort(null, 'doctor');
    expect(s).toEqual({ key: 'doctor', dir: 'asc' });
    s = cycleSort(s, 'doctor');
    expect(s).toEqual({ key: 'doctor', dir: 'desc' });
    expect(cycleSort(s, 'doctor')).toBe(null);
    expect(cycleSort(s, 'issue')).toEqual({ key: 'issue', dir: 'asc' });
  });
});

describe('sortEntries', () => {
  const rows = [
    { id: 'a', doctor: 'Zhou', status: 'resolved', q: 0, next: '' },
    { id: 'b', doctor: '', status: 'treating', q: 3, next: '2026-10-01' },
    { id: 'c', doctor: 'adams', status: 'none', q: 1, next: '2026-09-20' },
  ];
  const valueOf = (e, key) => ({ doctor: e.doctor, status: e.status, questions: e.q, nextVisit: e.next })[key];
  const ids = (sort) => sortEntries(rows, sort, valueOf).map((e) => e.id);

  it('leaves the order alone with no sort', () => {
    expect(ids(null)).toEqual(['a', 'b', 'c']);
  });

  it('sorts text ignoring case, blanks last in both directions', () => {
    expect(ids({ key: 'doctor', dir: 'asc' })).toEqual(['c', 'a', 'b']);
    expect(ids({ key: 'doctor', dir: 'desc' })).toEqual(['a', 'c', 'b']);
  });

  it('sorts status by its own order, not alphabetically', () => {
    expect(ids({ key: 'status', dir: 'asc' })).toEqual(['b', 'c', 'a']); // treating, ongoing, resolved
  });

  it('sorts numbers and dates as numbers and dates', () => {
    expect(ids({ key: 'questions', dir: 'desc' })).toEqual(['b', 'c', 'a']);
    expect(ids({ key: 'nextVisit', dir: 'asc' })).toEqual(['c', 'b', 'a']);
  });
});
