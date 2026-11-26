import { describe, expect, it } from 'vitest';
import { countByField, deletionWarning } from './weddingSharedLabels';

describe('countByField', () => {
  it('counts guests per value and skips blanks', () => {
    const m = countByField([{ category: 'Family' }, { category: 'Family' }, { category: '' }, {}], 'category');
    expect([...m]).toEqual([['Family', 2]]);
  });
  it('treats a missing list as empty', () => {
    expect(countByField(null, 'group').size).toBe(0);
  });
});

describe('deletionWarning', () => {
  const opts = { noun: 'category', here: 'this version', there: 'the main list' };
  it('is empty when nothing deleted has guests', () => {
    expect(deletionWarning([{ from: 'A', deleted: true, count: 0, otherCount: 0 }, { from: 'B', deleted: false, count: 3, otherCount: 9 }], opts)).toBe('');
  });
  it('names the other list when the category looks empty here', () => {
    const msg = deletionWarning([{ from: 'Family', deleted: true, count: 0, otherCount: 42 }], opts);
    expect(msg).toContain('Family: 42 guests on the main list');
    expect(msg).not.toContain('on this version');
    expect(msg).toContain('this category');
  });
  it('lists both lists and pluralises', () => {
    const msg = deletionWarning([
      { from: 'Work', deleted: true, count: 1, otherCount: 2 },
      { from: 'Friends', deleted: true, count: 5, otherCount: 0 },
    ], opts);
    expect(msg).toContain('Work: 1 guest on this version and 2 guests on the main list');
    expect(msg).toContain('Friends: 5 guests on this version');
    expect(msg).toContain('these categories');
  });
});
