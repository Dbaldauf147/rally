import { describe, it, expect } from 'vitest';
import { groupTokens, bucketByGroup, NO_GROUP } from './peopleGroups';

describe('groupTokens', () => {
  it('splits and trims a comma list', () => {
    expect(groupTokens(' Family,  College ,')).toEqual(['Family', 'College']);
  });
  it('treats blanks as no groups', () => {
    expect(groupTokens('')).toEqual([]);
    expect(groupTokens(undefined)).toEqual([]);
  });
});

describe('bucketByGroup', () => {
  const people = [
    { name: 'Ann', group: 'Work' },
    { name: 'Bo', group: 'college, Work' },
    { name: 'Cy', group: '' },
    { name: 'Di', group: 'Family' },
  ];
  const buckets = bucketByGroup(people, p => groupTokens(p.group));

  it('sorts groups A–Z case-insensitively, with No group last', () => {
    expect(buckets.map(b => b.label)).toEqual(['college', 'Family', 'Work', NO_GROUP]);
  });
  it('puts someone in two groups in both tables, keeping input order', () => {
    expect(buckets.find(b => b.label === 'Work').items.map(p => p.name)).toEqual(['Ann', 'Bo']);
    expect(buckets.find(b => b.label === 'college').items.map(p => p.name)).toEqual(['Bo']);
  });
  it('leaves out No group when everyone has one', () => {
    expect(bucketByGroup([{ group: 'A' }], p => groupTokens(p.group)).map(b => b.label)).toEqual(['A']);
  });
  it('does not double-list a repeated token', () => {
    expect(bucketByGroup([{ group: 'A, A' }], p => groupTokens(p.group))[0].items).toHaveLength(1);
  });
});
