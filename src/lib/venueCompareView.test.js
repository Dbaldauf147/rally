import { describe, it, expect } from 'vitest';
import { orderBlocks, moveBlock, nextSort, sortedIndexes, matchesSearch } from './venueCompareView';
import { normalizePlan, setVenueHidden, venueComparison } from './weddingBudgetPlan';

describe('orderBlocks', () => {
  it('keeps the default order with nothing saved', () => {
    expect(orderBlocks(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c']);
  });
  it('follows the saved order, dropping gone keys and placing new ones after their default neighbour', () => {
    expect(orderBlocks(['a', 'b', 'n', 'c'], ['c', 'gone', 'b', 'a'])).toEqual(['c', 'b', 'n', 'a']);
    expect(orderBlocks(['n', 'a'], ['a'])).toEqual(['n', 'a']);
  });
});

describe('moveBlock', () => {
  it('moves onto another block or by a step', () => {
    expect(moveBlock(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
    expect(moveBlock(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
  });
  it('leaves the order alone at an edge or for an unknown key', () => {
    const o = ['a', 'b'];
    expect(moveBlock(o, 'a', -1)).toBe(o);
    expect(moveBlock(o, 'x', 1)).toBe(o);
  });
});

describe('nextSort', () => {
  it('cycles ascending, descending, off', () => {
    expect(nextSort(null, 'total')).toEqual({ key: 'total', dir: 'asc' });
    expect(nextSort({ key: 'total', dir: 'asc' }, 'total')).toEqual({ key: 'total', dir: 'desc' });
    expect(nextSort({ key: 'total', dir: 'desc' }, 'total')).toBeNull();
    expect(nextSort({ key: 'total', dir: 'desc' }, 'pp')).toEqual({ key: 'pp', dir: 'asc' });
  });
});

describe('sortedIndexes', () => {
  const vals = [30, null, 10, 20, 10];
  it('sorts numbers either way with blanks last and ties in saved order', () => {
    expect(sortedIndexes(5, { key: 'x', dir: 'asc' }, (i) => vals[i])).toEqual([2, 4, 3, 0, 1]);
    expect(sortedIndexes(5, { key: 'x', dir: 'desc' }, (i) => vals[i])).toEqual([0, 3, 2, 4, 1]);
  });
  it('sorts names without regard to case', () => {
    const names = ['b', 'A', '', 'c'];
    expect(sortedIndexes(4, { key: 'name', dir: 'asc' }, (i) => names[i])).toEqual([1, 0, 3, 2]);
  });
  it('keeps the saved order with no sort', () => {
    expect(sortedIndexes(3, null, () => 0)).toEqual([0, 1, 2]);
  });
});

describe('matchesSearch', () => {
  it('needs every word somewhere, any case', () => {
    expect(matchesSearch('', ['x'])).toBe(true);
    expect(matchesSearch('montauk', ['360 East', 'Montauk & Hamptons'])).toBe(true);
    expect(matchesSearch('yacht stamford', ['Stamford Yacht Club'])).toBe(true);
    expect(matchesSearch('yacht montauk', ['Stamford Yacht Club', 'Conneticut'])).toBe(false);
  });
});

describe('hidden venues and the saved layout', () => {
  it('hides and shows a venue, and keeps it through normalizing', () => {
    const quotes = setVenueHidden([{ id: 'v1', name: 'Barn' }, { id: 'v2', name: 'Inn' }], 'v1', true);
    expect(quotes.map((q) => !!q.hidden)).toEqual([true, false]);
    const plan = normalizePlan({ venueQuotes: quotes });
    expect(plan.venueQuotes.map((q) => q.hidden)).toEqual([true, false]);
    expect(venueComparison([], plan.venueQuotes, 0).venues.map((v) => v.hidden)).toEqual([true, false]);
    expect(setVenueHidden(quotes, 'v1', false)[0].hidden).toBe(false);
  });
  it('normalizes the column order and sort', () => {
    expect(normalizePlan({}).compareView).toEqual({ order: [], sort: null });
    expect(normalizePlan({ compareView: { order: ['a', 'a', 3, 'b'], sort: { key: 'total', dir: 'desc' } } }).compareView)
      .toEqual({ order: ['a', 'b'], sort: { key: 'total', dir: 'desc' } });
    expect(normalizePlan({ compareView: { sort: { key: 'total', dir: 'up' } } }).compareView.sort).toBeNull();
  });
});
