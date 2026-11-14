import { describe, it, expect } from 'vitest';
import { parsePastDraws, namesIn, importCandidates, matchName, importedPairs } from './secretSantaImport';
import { lastDraw } from './secretSanta';

const TEXT = `
Secret Santa 2025
Thursday, December 25, 2025
Dan, Mike, Sunnie, Johnny and 2 others...
View draw
Amanda drew Grace.
Dan drew Milan.
Grace drew Dan.

Christmas 2023
Monday, December 25, 2023
Amanda drew Sunnie.
Dan  drew Katie
Draw names again

2022 Xmas Round 2
Amanda -> Dan
`;

describe('parsePastDraws', () => {
  it('splits on titled years and keeps only the picks', () => {
    expect(parsePastDraws(TEXT)).toEqual([
      { title: 'Secret Santa 2025', year: 2025, pairs: [
        { giver: 'Amanda', receiver: 'Grace' }, { giver: 'Dan', receiver: 'Milan' }, { giver: 'Grace', receiver: 'Dan' },
      ] },
      { title: 'Christmas 2023', year: 2023, pairs: [{ giver: 'Amanda', receiver: 'Sunnie' }, { giver: 'Dan', receiver: 'Katie' }] },
      { title: '2022 Xmas Round 2', year: 2022, pairs: [{ giver: 'Amanda', receiver: 'Dan' }] },
    ]);
  });

  it('takes picks with no heading as one undated draw', () => {
    expect(parsePastDraws('Ann drew Ben\nBen drew Ann')).toEqual([
      { title: '', year: null, pairs: [{ giver: 'Ann', receiver: 'Ben' }, { giver: 'Ben', receiver: 'Ann' }] },
    ]);
  });

  it('lets a repeated giver replace the earlier line, and copes with full names', () => {
    expect(parsePastDraws('2024\nAnn Lee drew Ben Ray.\nann lee drew Cy')[0].pairs).toEqual([{ giver: 'ann lee', receiver: 'Cy' }]);
  });

  it('is empty for text with no picks', () => {
    expect(parsePastDraws('Secret Santa 2025\nnothing here')).toEqual([]);
    expect(parsePastDraws(null)).toEqual([]);
  });
});

describe('matching names to people', () => {
  const members = {
    u1: { name: 'Dan Baldauf', email: 'dan@x.com' },
    u2: { name: 'Mike Baldauf', email: 'mike@x.com' },
    u3: { name: 'Grace', email: '' },
  };
  const friends = [
    { id: 'f1', name: 'Mike Baldauf', email: 'mike@x.com' }, // already a guest
    { id: 'f2', name: 'Mike Jones', email: 'mj@x.com' },
    { id: 'f3', name: 'Amanda Smith', email: 'amanda@x.com' },
    { id: 'f4', name: 'Katie A' }, { id: 'f5', name: 'Katie B' },
    { id: 'f6', name: '' },
  ];
  const candidates = importCandidates(members, friends);

  it('lists guests, then friends who are not already guests', () => {
    expect(candidates.map((c) => c.id).sort()).toEqual(['f:f2', 'f:f3', 'f:f4', 'f:f5', 'm:u1', 'm:u2', 'm:u3']);
  });

  it('matches a first name to the guest before looking at Friends', () => {
    expect(matchName('Mike', candidates)).toBe('m:u2');
    expect(matchName('dan', candidates)).toBe('m:u1');
    expect(matchName('Grace', candidates)).toBe('m:u3');
    expect(matchName('Amanda', candidates)).toBe('f:f3');
  });

  it('will not guess between two people, or invent one', () => {
    expect(matchName('Katie', candidates)).toBe('');
    expect(matchName('Milan', candidates)).toBe('');
    expect(matchName('', candidates)).toBe('');
  });

  it('collects each name once', () => {
    expect(namesIn(parsePastDraws(TEXT))).toEqual(['Amanda', 'Grace', 'Dan', 'Milan', 'Sunnie', 'Katie']);
  });

  it('stores mapped people so next year’s draw recognises them', () => {
    const draw = { year: 2025, pairs: [{ giver: 'Dan', receiver: 'Amanda' }, { giver: 'Mike', receiver: 'Milan' }] };
    const mapping = { Dan: 'm:u1', Amanda: 'f:f3', Mike: 'm:u2', Milan: '' };
    const pairs = importedPairs(draw, mapping, candidates);
    expect(pairs).toEqual([
      { giver: { key: 'u1', name: 'Dan Baldauf', email: 'dan@x.com' }, receiver: { key: '', name: 'Amanda Smith', email: 'amanda@x.com' } },
      { giver: { key: 'u2', name: 'Mike Baldauf', email: 'mike@x.com' }, receiver: { key: '', name: 'Milan', email: '' } },
    ]);
    // Amanda joins the event later under a new key: her email still links the pick.
    const later = { ...members, u9: { name: 'Amanda S.', email: 'amanda@x.com' } };
    expect(lastDraw({ 2025: { pairs } }, 2026, later)).toEqual({ year: 2025, map: { u1: 'u9' } });
  });
});
