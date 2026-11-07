import { describe, it, expect } from 'vitest';
import { planComesWithSync, planComesWithBackfill } from './comesWith';

const f = (id, linkedTo = '') => ({ id, name: id, linkedTo });
const asMap = (writes) => Object.fromEntries(writes.map((w) => [w.id, w.linkedTo]));

describe('planComesWithSync', () => {
  it('links the new partner back', () => {
    expect(asMap(planComesWithSync([f('a'), f('b')], 'a', 'b'))).toEqual({ b: 'a' });
  });

  it('writes nothing when the partner already points back', () => {
    expect(planComesWithSync([f('a', 'b'), f('b', 'a')], 'a', 'b')).toEqual([]);
  });

  it('unlinks the old partner when the link is cleared', () => {
    expect(asMap(planComesWithSync([f('a', 'b'), f('b', 'a')], 'a', ''))).toEqual({ b: '' });
  });

  it('switching partner unlinks the old one and links the new one', () => {
    const friends = [f('a', 'b'), f('b', 'a'), f('c')];
    expect(asMap(planComesWithSync(friends, 'a', 'c'))).toEqual({ b: '', c: 'a' });
  });

  it("takes the new partner off their old pair", () => {
    const friends = [f('a'), f('b', 'd'), f('d', 'b')];
    expect(asMap(planComesWithSync(friends, 'a', 'b'))).toEqual({ b: 'a', d: '' });
  });

  it('leaves unrelated links alone', () => {
    const friends = [f('a'), f('b'), f('x', 'y'), f('y', 'x')];
    expect(asMap(planComesWithSync(friends, 'a', 'b'))).toEqual({ b: 'a' });
  });

  it('ignores a link to a contact that is gone, or to themselves', () => {
    expect(planComesWithSync([f('a')], 'a', 'zz')).toEqual([]);
    expect(planComesWithSync([f('a')], 'a', 'a')).toEqual([]);
  });
});

describe('planComesWithBackfill', () => {
  it('fills in the missing half of a one-way link', () => {
    expect(planComesWithBackfill([f('a', 'b'), f('b')])).toEqual([{ id: 'b', linkedTo: 'a' }]);
  });

  it('leaves complete pairs and dangling links alone', () => {
    expect(planComesWithBackfill([f('a', 'b'), f('b', 'a'), f('c', 'gone')])).toEqual([]);
  });

  it('does not overwrite someone who comes with another person', () => {
    expect(planComesWithBackfill([f('a', 'b'), f('b', 'c'), f('c', 'b')])).toEqual([]);
  });

  it('skips a contact two people point at', () => {
    expect(planComesWithBackfill([f('a', 'b'), f('c', 'b'), f('b')])).toEqual([]);
  });
});
