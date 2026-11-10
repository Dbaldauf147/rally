import { describe, it, expect } from 'vitest';
import {
  seedCategories, normalizePlan, categoryPct, totalPct, contributorTotals, effectiveTotal,
  amountFor, pctFromAmount, setCategoryPct, scaleTo100, parseMoney, parsePct, formatMoney, formatPct,
} from './weddingBudgetPlan';

describe('seed split', () => {
  it('adds to 100% and each category matches its items', () => {
    const cats = seedCategories();
    expect(totalPct(cats)).toBe(100);
    const byName = Object.fromEntries(cats.map((c) => [c.name, categoryPct(c)]));
    expect(byName['Venue, catering, bar, rentals']).toBe(48);
    expect(byName['Photography and videography']).toBe(12);
    expect(byName['Stationery']).toBe(3);
    expect(byName['Contingency']).toBe(4);
    expect(cats).toHaveLength(11);
  });
  it('has unique ids', () => {
    const ids = seedCategories().flatMap((c) => [c.id, ...c.items.map((i) => i.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('normalizePlan', () => {
  it('starts a missing plan from the seed with no total', () => {
    const p = normalizePlan(undefined);
    expect(p.total).toBeNull();
    expect(p.contributors).toEqual([]);
    expect(totalPct(p.categories)).toBe(100);
  });
  it('keeps an emptied list empty rather than reseeding', () => {
    expect(normalizePlan({ categories: [] }).categories).toEqual([]);
  });
  it('cleans junk values', () => {
    const p = normalizePlan({ total: '-5', contributors: [{ name: 'Mom', low: 'x', high: 5000 }, null], categories: [{ name: 'A', pct: -3, items: 'no' }] });
    expect(p.total).toBe(0);
    expect(p.contributors).toHaveLength(1);
    expect(p.contributors[0]).toMatchObject({ name: 'Mom', low: null, high: 5000 });
    expect(p.categories[0]).toMatchObject({ name: 'A', pct: 0, items: [] });
  });
});

describe('contributors and totals', () => {
  it('sums ranges, treating a one-sided range as a point', () => {
    const t = contributorTotals([
      { low: 10000, high: 20000 }, { low: null, high: 5000 }, { low: 3000, high: null }, { low: null, high: null },
      { low: 8000, high: 6000 },
    ]);
    expect(t).toEqual({ low: 24000, high: 36000, mid: 30000, counted: 4 });
  });
  it('uses the typed total, else the contributor midpoint', () => {
    expect(effectiveTotal({ total: 50000, contributors: [{ low: 1, high: 3 }] })).toEqual({ amount: 50000, source: 'set' });
    expect(effectiveTotal({ total: null, contributors: [{ low: 10000, high: 30000 }] })).toEqual({ amount: 20000, source: 'contributors' });
    expect(effectiveTotal({ total: null, contributors: [] })).toEqual({ amount: 0, source: 'none' });
  });
  it('converts between % and $', () => {
    expect(amountFor(18, 50000)).toBe(9000);
    expect(pctFromAmount(9000, 50000)).toBe(18);
    expect(pctFromAmount(100, 0)).toBeNull();
  });
});

describe('editing percentages', () => {
  it('rescales a category’s items in proportion', () => {
    const photo = seedCategories().find((c) => c.name === 'Photography and videography');
    const next = setCategoryPct(photo, 24);
    expect(categoryPct(next)).toBe(24);
    expect(next.items.map((i) => i.pct)).toEqual([14, 8, 2]);
  });
  it('splits evenly when the items are all 0%', () => {
    const next = setCategoryPct({ id: 'c', name: 'X', pct: 0, items: [{ id: 'a', pct: 0 }, { id: 'b', pct: 0 }] }, 6);
    expect(next.items.map((i) => i.pct)).toEqual([3, 3]);
  });
  it('sets a plain category directly', () => {
    expect(setCategoryPct({ id: 'c', name: 'Cake', pct: 2, items: [] }, 3.5).pct).toBe(3.5);
  });
  it('scales the whole split to exactly 100%', () => {
    const cats = seedCategories();
    cats[0] = setCategoryPct(cats[0], 55); // now 107%
    expect(totalPct(cats)).toBe(107);
    expect(totalPct(scaleTo100(cats))).toBe(100);
    const odd = [{ id: 'a', pct: 1, items: [] }, { id: 'b', pct: 1, items: [] }, { id: 'c', pct: 1, items: [] }];
    expect(totalPct(scaleTo100(odd))).toBe(100);
  });
});

describe('parsing and formatting', () => {
  it('reads money the way people type it', () => {
    expect(parseMoney('$40,000')).toBe(40000);
    expect(parseMoney('40k')).toBe(40000);
    expect(parseMoney('1.5m')).toBe(1500000);
    expect(parseMoney(' ')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
  });
  it('reads percents', () => {
    expect(parsePct('7.5%')).toBe(7.5);
    expect(parsePct('')).toBeNull();
    expect(parsePct('-1')).toBeNull();
  });
  it('formats', () => {
    expect(formatMoney(9000.4)).toBe('$9,000');
    expect(formatPct(1.5)).toBe('1.5%');
    expect(formatPct(33.3333)).toBe('33.33%');
  });
});
