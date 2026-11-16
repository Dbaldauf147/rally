import { describe, it, expect } from 'vitest';
import {
  normalizeItems, profileForEditing, profileForSaving, hasProfile,
  insertItem, indentItem, outdentItem, removeItem, moveItem,
  parseOutline, mergeParsed, DEFAULT_SECTIONS, lineHint,
} from './friendProfile';

const rows = (...spec) => spec.map(([text, depth], i) => ({ id: `r${i}`, text, depth }));
const shape = (items) => items.map((i) => `${'-'.repeat(i.depth)}${i.text}`);

describe('normalizeItems', () => {
  it('pulls a row back to at most one level under the row above', () => {
    expect(shape(normalizeItems(rows(['Food', 2], ['Omakase', 3], ['Burgers', 1])))).toEqual(['Food', '-Omakase', '-Burgers']);
  });
});

describe('profileForEditing / profileForSaving', () => {
  it('opens a friend with nothing on the default sections', () => {
    expect(profileForEditing(undefined).map((s) => s.title)).toEqual(DEFAULT_SECTIONS);
    expect(DEFAULT_SECTIONS).toEqual(['Likes', 'Things I appreciate', 'Foods', 'Drinks', 'Desserts', 'Places', 'Pains']);
  });

  it('offers the defaults a friend with a stored profile is missing, after their own', () => {
    const opened = profileForEditing([
      { id: 'x', title: 'Sizes', items: rows(['Shoes 9', 0]) },
      { id: 'f', title: 'foods', items: rows(['Omakase', 0]) },
    ]);
    expect(opened.map((s) => s.title)).toEqual(['Sizes', 'foods', 'Likes', 'Things I appreciate', 'Drinks', 'Desserts', 'Places', 'Pains']);
    // Opening and saving untouched stores nothing new.
    expect(profileForSaving(opened).map((s) => s.title)).toEqual(['Sizes', 'foods']);
  });

  it('keeps a Pains section once something is logged in it, and drops it while empty', () => {
    const opened = profileForEditing(undefined);
    expect(profileForSaving(opened)).toEqual([]);
    const logged = opened.map((s) => (s.title === 'Pains' ? { ...s, items: rows(['Bad back', 0], ['Physio on Tuesdays', 1]) } : s));
    expect(profileForSaving(logged).map((s) => [s.title, shape(s.items)])).toEqual([['Pains', ['Bad back', '-Physio on Tuesdays']]]);
  });

  it('asks for what they are dealing with on a Pains line, and a category elsewhere', () => {
    expect(lineHint('Pains', 0)).toMatch(/dealing with/);
    expect(lineHint(' pains ', 1)).toMatch(/Detail/);
    expect([lineHint('Likes', 0), lineHint('Likes', 2), lineHint(undefined, 0)]).toEqual(['Category', 'Detail', 'Category']);
  });

  it('saves only what was written, dropping blank lines and untouched defaults', () => {
    const saved = profileForSaving([
      { id: 'a', title: 'Likes', items: rows(['Sauna', 0], ['  ', 0], ['Plants ', 0]) },
      { id: 'b', title: 'Things I appreciate', items: [] },
      { id: 'c', title: 'Gift sizes', items: [] },
    ]);
    expect(saved.map((s) => [s.title, s.items.map((i) => i.text)])).toEqual([
      ['Likes', ['Sauna', 'Plants']],
      ['Gift sizes', []],
    ]);
    expect(hasProfile(saved)).toBe(true);
    expect(hasProfile([])).toBe(false);
  });
});

describe('editing an outline', () => {
  const likes = rows(['Drinking', 0], ['Coffee', 1], ['Cold brew', 2], ['Tequila', 1], ['Food', 0]);

  it('inserts after a row at its depth, or where told', () => {
    expect(shape(insertItem(likes, 1, { text: 'Tea' }).items)).toEqual(['Drinking', '-Coffee', '-Tea', '--Cold brew', '-Tequila', 'Food']);
    expect(shape(insertItem(likes, 2, { text: 'Hosting', depth: 0 }).items).slice(3)).toEqual(['Hosting', '-Tequila', 'Food']);
    expect(shape(insertItem([], -1, { text: 'x' }).items)).toEqual(['x']);
  });

  it('indents and outdents a row with what is nested under it', () => {
    expect(shape(indentItem(likes, 3))).toEqual(['Drinking', '-Coffee', '--Cold brew', '--Tequila', 'Food']);
    expect(shape(outdentItem(likes, 1))).toEqual(['Drinking', 'Coffee', '-Cold brew', '-Tequila', 'Food']);
    // The first child can't go deeper, and nothing goes past the top.
    expect(indentItem(likes, 1)).toEqual(likes);
    expect(outdentItem(likes, 0)).toEqual(likes);
  });

  it('removes a row and lifts its children rather than deleting them', () => {
    expect(shape(removeItem(likes, 1))).toEqual(['Drinking', '-Cold brew', '-Tequila', 'Food']);
  });

  it('moves a row and its children past a sibling', () => {
    expect(shape(moveItem(likes, 3, -1))).toEqual(['Drinking', '-Tequila', '-Coffee', '--Cold brew', 'Food']);
    expect(shape(moveItem(likes, 0, 1))).toEqual(['Food', 'Drinking', '-Coffee', '--Cold brew', '-Tequila']);
    expect(moveItem(likes, 1, -1)).toEqual(likes); // no sibling above
  });
});

describe('parseOutline', () => {
  it('nests by indentation in whatever unit, stripping bullets', () => {
    const [s] = parseOutline('Working out\n    - Running\n    - Hot yoga\n\nDrinking\n\t• Coffee\n\t\tCold brew\n\t2. Tequila\nSex');
    expect(s.title).toBe('');
    expect(shape(s.items)).toEqual(['Working out', '-Running', '-Hot yoga', 'Drinking', '-Coffee', '--Cold brew', '-Tequila', 'Sex']);
  });

  it('starts a section at a "# " heading', () => {
    const parsed = parseOutline('Sauna\n# Things I appreciate\nHer brain\n  That she is curious');
    expect(parsed.map((p) => [p.title, shape(p.items)])).toEqual([
      ['', ['Sauna']],
      ['Things I appreciate', ['Her brain', '-That she is curious']],
    ]);
  });

  it('merges into the matching section, the pasted-into one, or a new one', () => {
    const start = [
      { id: 'l', title: 'Likes', items: rows(['Golf', 0]) },
      { id: 't', title: 'Things I appreciate', items: [] },
    ];
    const out = mergeParsed(start, parseOutline('Sauna\n# things i appreciate\nHer brain\n# Sizes\nShoes 9'), 'l');
    expect(out.map((s) => [s.title, s.items.map((i) => i.text)])).toEqual([
      ['Likes', ['Golf', 'Sauna']],
      ['Things I appreciate', ['Her brain']],
      ['Sizes', ['Shoes 9']],
    ]);
  });
});
