import { describe, it, expect } from 'vitest';
import {
  seedCategories, normalizePlan, categoryPct, totalPct, contributorTotals, effectiveTotal,
  amountFor, pctFromAmount, setCategoryPct, scaleTo100, parseMoney, parsePct, formatMoney, formatPct, formatRate,
  guestCounts, headcount, plateAmount, resolveCategories, resolveMarkups,
} from './weddingBudgetPlan';

const FOOD = 'i-food-cocktail-hour-dinner-vendor-meals';
const item = (id, pct, extra = {}) => ({ id, name: id, pct, perPlate: null, markup: null, ...extra });
const find = (cats, id) => cats.flatMap((c) => c.items).find((i) => i.id === id);

describe('seed split', () => {
  it('charges service on food + bar and tax on those plus service', () => {
    const cats = resolveMarkups(seedCategories());
    expect(find(cats, 'i-service-charge-and-gratuity').pct).toBe(5.5); // 22% of 25
    expect(find(cats, 'i-tax').pct).toBe(2.707); // 8.875% of 30.5
    expect(categoryPct(cats[0])).toBe(47.207);
    expect(totalPct(cats)).toBe(99.207);
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
    expect(p.v).toBe(2);
    expect(p.guests).toEqual({ source: 'all', count: null });
    expect(p.contributors).toEqual([]);
    expect(p.categories).toHaveLength(11);
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
  it('upgrades an old flat service line into service + tax on food and bar', () => {
    const old = {
      categories: [{ id: 'c1', name: 'Venue', items: [
        { id: 'i-venue-site-fee', name: 'Venue site fee', pct: 10 },
        { id: FOOD, name: 'Food (cocktail hour, dinner, vendor meals)', pct: 18 },
        { id: 'i-bar-and-beverages', name: 'Bar and beverages', pct: 7 },
        { id: 'i-service-charge-tax-gratuity', name: 'Service charge, tax, gratuity', pct: 9 },
      ] }],
    };
    const p = normalizePlan(old);
    const names = p.categories[0].items.map((i) => i.name);
    expect(names).toEqual(['Venue site fee', 'Food (cocktail hour, dinner, vendor meals)', 'Bar and beverages', 'Service charge and gratuity', 'Tax']);
    expect(p.categories[0].items[3].markup).toEqual({ rate: 22, of: [FOOD, 'i-bar-and-beverages'] });
    expect(p.categories[0].items[4].markup.of).toEqual([FOOD, 'i-bar-and-beverages', 'i-service-charge-and-gratuity']);
    // Once upgraded it doesn't happen again, even if a flat line comes back.
    const again = normalizePlan({ ...p, categories: [{ ...p.categories[0], items: [...p.categories[0].items, { id: 'x', name: 'Service charge, tax, gratuity', pct: 1 }] }] });
    expect(again.categories[0].items).toHaveLength(6);
  });
  it('moves an old per-line guest count up to the plan', () => {
    const p = normalizePlan({ categories: [{ name: 'Food', items: [{ name: 'Dinner', pct: 5, perPlate: { price: '150', source: 'manual', count: 99.6 } }] }] });
    expect(p.guests).toEqual({ source: 'manual', count: 100 });
    expect(p.categories[0].items[0].perPlate).toEqual({ price: 150 });
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

describe('markups', () => {
  it('skips missing lines and zeroes a loop', () => {
    const cats = [{ id: 'c', items: [
      item('a', 10),
      item('m1', 0, { markup: { rate: 50, of: ['a', 'gone'] } }),
      item('x', 0, { markup: { rate: 10, of: ['y'] } }),
      item('y', 0, { markup: { rate: 10, of: ['x'] } }),
    ] }];
    const r = resolveMarkups(cats);
    expect(r[0].items.map((i) => i.pct)).toEqual([10, 5, 0, 0]);
  });
});

describe('editing percentages', () => {
  it('rescales a category’s items in proportion', () => {
    const cats = seedCategories();
    const next = setCategoryPct(cats, 'c-photography-and-videography', 24);
    expect(next[1].items.map((i) => i.pct)).toEqual([14, 8, 2]);
  });
  it('scales a category with markups to land exactly on the target', () => {
    const cats = resolveMarkups(seedCategories());
    const next = setCategoryPct(cats, cats[0].id, 60);
    expect(categoryPct(next[0])).toBe(60);
    // Service is still 22% of food + bar.
    const fb = find(next, FOOD).pct + find(next, 'i-bar-and-beverages').pct;
    expect(find(next, 'i-service-charge-and-gratuity').pct).toBeCloseTo(fb * 0.22, 2);
  });
  it('splits evenly when the items are all 0%', () => {
    const next = setCategoryPct([{ id: 'c', name: 'X', pct: 0, items: [item('a', 0), item('b', 0)] }], 'c', 6);
    expect(next[0].items.map((i) => i.pct)).toEqual([3, 3]);
  });
  it('sets a plain category directly', () => {
    expect(setCategoryPct([{ id: 'c', name: 'Cake', pct: 2, items: [] }], 'c', 3.5)[0].pct).toBe(3.5);
  });
  it('scales the whole split, markups included, to exactly 100%', () => {
    const cats = resolveMarkups(seedCategories());
    expect(totalPct(cats)).toBe(99.207);
    expect(totalPct(scaleTo100(cats))).toBe(100);
    const odd = [{ id: 'a', pct: 1, items: [] }, { id: 'b', pct: 1, items: [] }, { id: 'c', pct: 1, items: [] }];
    expect(totalPct(scaleTo100(odd))).toBe(100);
  });
});

describe('guests and per plate', () => {
  const counts = guestCounts([
    { status: 'Confirmed' }, { status: 'Confirmed' }, { status: 'Pending' }, { status: 'Not coming' },
    { status: 'Confirmed', category: 'Hide' }, {},
  ]);
  it('counts the guest list three ways, never the hidden', () => {
    expect(counts).toEqual({ all: 5, attending: 4, confirmed: 2 });
    expect(headcount({ source: 'confirmed' }, counts)).toBe(2);
    expect(headcount({ source: 'manual', count: 120 }, counts)).toBe(120);
    expect(headcount({ source: 'manual', count: null }, counts)).toBe(0);
  });
  it('prices price × guests', () => {
    expect(plateAmount({ price: 150 }, 120)).toBe(18000);
    expect(plateAmount({ price: null }, 120)).toBe(0);
  });
  it('holds per-plate lines still and lets markups follow them when scaling', () => {
    const cats = normalizePlan({ v: 2, categories: [
      { id: 'f', name: 'Food', items: [
        item('d', 1, { perPlate: { price: 100 } }), item('b', 10),
        item('s', 0, { markup: { rate: 20, of: ['d', 'b'] } }),
      ] },
      { id: 'o', name: 'Other', pct: 50, items: [] },
    ] }).categories;
    const r = resolveCategories(cats, 100000, 200); // dinner $20,000 = 20%
    expect(r[0].items.map((i) => i.pct)).toEqual([20, 10, 6]);
    expect(totalPct(r)).toBe(86);
    const scaled = scaleTo100(r);
    expect(scaled[0].items[0].pct).toBe(20);
    expect(totalPct(scaled)).toBe(100);
    expect(scaled[0].items[2].pct).toBeCloseTo((20 + scaled[0].items[1].pct) * 0.2, 2);
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
    expect(formatRate(8.875)).toBe('8.875%');
  });
});
