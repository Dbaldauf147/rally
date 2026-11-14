import { describe, it, expect } from 'vitest';
import {
  seedCategories, normalizePlan, categoryPct, totalPct, contributorTotals, effectiveTotal,
  amountFor, pctFromAmount, setCategoryPct, scaleTo100, parseMoney, parsePct, formatMoney, formatPct, formatRate,
  guestCounts, headcount, plateAmount, resolveCategories, resolveMarkups,
  categoryTaxPct, totalTaxPct, grossPct, calculatorGroups, calculatorTotals,
} from './weddingBudgetPlan';

const FOOD = 'i-food-cocktail-hour-dinner-vendor-meals';
const item = (id, pct, extra = {}) => ({ id, name: id, pct, perPlate: null, markup: null, ...extra });
const find = (cats, id) => cats.flatMap((c) => c.items).find((i) => i.id === id);

describe('seed split', () => {
  it('charges service on food + bar, with no separate tax line', () => {
    const cats = resolveMarkups(seedCategories());
    expect(find(cats, 'i-service-charge-and-gratuity').pct).toBe(5.5); // 22% of 25
    expect(find(cats, 'i-tax')).toBeUndefined();
    expect(categoryPct(cats[0])).toBe(44.5);
    expect(totalPct(cats)).toBe(96.5);
    expect(cats).toHaveLength(11);
  });
  it('taxes everything but the planner, officiant, contingency and postage', () => {
    const cats = resolveMarkups(seedCategories());
    const untaxed = cats.flatMap((c) => (c.items.length ? c.items : [c])).filter((l) => !l.taxed).map((l) => l.id);
    expect(untaxed.sort()).toEqual(['c-contingency', 'c-officiant-and-marriage-license', 'c-planner-or-coordinator', 'i-postage']);
    // 86% of the split is taxed: 86 × 8.875% = 7.6325
    expect(totalTaxPct(cats, 8.875)).toBe(7.633);
    expect(grossPct(cats, 8.875)).toBe(104.133);
    expect(categoryTaxPct(cats.find((c) => c.id === 'c-stationery'), 10)).toBe(0.25); // 2.5 of 3 taxed
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
    expect(p.v).toBe(3);
    expect(p.guests).toEqual({ source: 'all', count: null });
    expect(p.salesTax).toEqual({ rate: 8.875 });
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
    expect(names).toEqual(['Venue site fee', 'Food (cocktail hour, dinner, vendor meals)', 'Bar and beverages', 'Service charge and gratuity']);
    expect(p.categories[0].items[3].markup).toEqual({ rate: 22, of: [FOOD, 'i-bar-and-beverages'] });
    expect(p.salesTax.rate).toBe(8.875);
    // Once upgraded it doesn't happen again, even if a flat line comes back.
    const again = normalizePlan({ ...p, categories: [{ ...p.categories[0], items: [...p.categories[0].items, { id: 'x', name: 'Service charge, tax, gratuity', pct: 1 }] }] });
    expect(again.categories[0].items).toHaveLength(5);
  });
  it('lifts a v2 tax line into the plan rate and keeps its own rate', () => {
    const p = normalizePlan({ v: 2, categories: [{ id: 'c', name: 'Venue', items: [
      { id: 'i-bar-and-beverages', name: 'Bar', pct: 7 },
      { id: 'i-tax', name: 'Tax', pct: 0, markup: { rate: 8, of: ['i-bar-and-beverages'] } },
    ] }] });
    expect(p.categories[0].items.map((i) => i.id)).toEqual(['i-bar-and-beverages']);
    expect(p.salesTax.rate).toBe(8);
    expect(p.categories[0].items[0].taxed).toBe(true);
    // A saved rate wins and nothing is lifted twice.
    expect(normalizePlan({ v: 3, salesTax: { rate: 6 }, categories: [] }).salesTax.rate).toBe(6);
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
  it('scales the whole split, markups and tax included, to exactly 100%', () => {
    const cats = resolveMarkups(seedCategories());
    expect(totalPct(scaleTo100(cats))).toBe(100);
    const withTax = scaleTo100(cats, 8.875);
    expect(grossPct(withTax, 8.875)).toBe(100);
    expect(totalPct(withTax)).toBeLessThan(93);
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

describe('calculator', () => {
  const cats = [
    { id: 'c1', name: 'Venue', taxed: true, items: [
      { id: 'a', name: 'Venue fee', pct: 10, taxed: true },
      { id: 'b', name: 'Rentals', pct: 5, taxed: false },
    ] },
    { id: 'c2', name: 'Planner', taxed: false, items: [] },
  ];

  it('lists a category without items as one line of its own', () => {
    expect(calculatorGroups(cats).map((g) => g.lines.map((l) => l.id))).toEqual([['a', 'b'], ['c2']]);
    expect(calculatorGroups(cats)[1].lines[0].name).toBe('Planner');
  });

  it('adds the typed amounts, with tax on taxed lines only', () => {
    const t = calculatorTotals(cats, { a: 1000, b: 500, c2: 2000, gone: 99 }, 10);
    expect(t).toMatchObject({ subtotal: 3500, tax: 100, total: 3600, filled: 3, lines: 3 });
    expect(calculatorTotals(cats, {}, 10)).toMatchObject({ subtotal: 0, tax: 0, total: 0, filled: 0, lines: 3 });
  });

  it('keeps the amounts through normalizePlan and drops junk', () => {
    const p = normalizePlan({ calculator: { amounts: { a: 1200, b: '300', c: -5, d: 'x', e: null } } });
    expect(p.calculator.amounts).toEqual({ a: 1200, b: 300, c: 0 });
    expect(normalizePlan(null).calculator).toEqual({ amounts: {}, included: {} });
  });
});

describe('venue pricing', async () => {
  const { normalizePlan, saveVenueQuote, findVenueQuote, sameAmounts, venueComparison, resolveCategories } = await import('./weddingBudgetPlan');
  const cats = [
    { id: 'c-venue', name: 'Venue', pct: 0, taxed: true, items: [
      { id: 'i-site', name: 'Site fee', pct: 10, taxed: true, perPlate: null, markup: null },
      { id: 'i-food', name: 'Food', pct: 20, taxed: true, perPlate: null, markup: null },
      { id: 'i-bar', name: 'Bar', pct: 5, taxed: false, perPlate: null, markup: null },
    ] },
    { id: 'c-planner', name: 'Planner', pct: 5, taxed: false, items: [] },
  ];
  const at = new Date('2026-11-14T12:00:00Z');

  it('saves a new venue, and updates one already saved under the same name', () => {
    let q = saveVenueQuote([], '  The Barn ', { 'i-site': 5000, 'i-food': '12000', junk: 'x' }, at);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ name: 'The Barn', amounts: { 'i-site': 5000, 'i-food': 12000 }, savedAt: '2026-11-14T12:00:00.000Z' });
    const id = q[0].id;
    q = saveVenueQuote(q, 'the barn', { 'i-site': 6000 }, at);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ id, name: 'the barn', amounts: { 'i-site': 6000 } });
    q = saveVenueQuote(q, 'Loft', { 'i-site': 9000 }, at);
    expect(q.map((x) => x.name)).toEqual(['the barn', 'Loft']);
    expect(findVenueQuote(q, 'LOFT').amounts).toEqual({ 'i-site': 9000 });
    expect(saveVenueQuote(q, '   ', { a: 1 }, at)).toBe(q);
  });

  it('keeps saved venues through normalizePlan, dropping nameless and repeated ones', () => {
    const plan = normalizePlan({ venueQuotes: [
      { id: 'v1', name: 'Barn', amounts: { a: 1, b: 'x' }, savedAt: 's' },
      { id: 'v1', name: 'Dupe', amounts: {} },
      { id: 'v2', name: ' ', amounts: {} },
      null,
    ] });
    expect(plan.venueQuotes).toEqual([{ id: 'v1', name: 'Barn', amounts: { a: 1 }, included: {}, savedAt: 's' }]);
    expect(normalizePlan(null).venueQuotes).toEqual([]);
  });

  it('knows when two sets of amounts are the same', () => {
    expect(sameAmounts({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameAmounts({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameAmounts({}, undefined)).toBe(true);
  });

  it('lines venues up against the same budget lines, with tax, totals and the cheapest', () => {
    const quotes = [
      { id: 'v1', name: 'Barn', amounts: { 'i-site': 5000, 'i-food': 10000, 'c-planner': 3000 }, savedAt: '' },
      { id: 'v2', name: 'Loft', amounts: { 'i-site': 8000, 'i-food': 9000, 'i-bar': 2000 }, savedAt: '' },
      { id: 'v3', name: 'Empty', amounts: {}, savedAt: '' },
    ];
    const c = venueComparison(resolveCategories(cats, 100000, 100), quotes, 10, 100000, 100);
    expect(c.rows.map((r) => [r.kind, r.name])).toEqual([
      ['category', 'Venue'], ['line', 'Site fee'], ['line', 'Food'], ['line', 'Bar'], ['line', 'Planner'],
    ]);
    const site = c.rows[1];
    expect(site).toMatchObject({ budgeted: 10000, amounts: [5000, 8000, null], low: 0 });
    expect(c.rows[2].low).toBe(1);
    expect(c.rows[3]).toMatchObject({ amounts: [null, 2000, null], low: null });
    expect(c.rows[4]).toMatchObject({ budgeted: 5000, amounts: [3000, null, null] });
    // Barn: 18,000 + 10% on site and food (1,500). Loft: 19,000 + 10% on 17,000 (bar isn't taxed).
    expect(c.venues[0]).toMatchObject({ subtotal: 18000, tax: 1500, total: 19500, filled: 3, perPerson: 195, diff: 80500 });
    expect(c.venues[1]).toMatchObject({ subtotal: 19000, tax: 1700, total: 20700, perPerson: 207 });
    expect(c.venues[2]).toMatchObject({ filled: 0, perPerson: null, diff: null });
    expect(c.cheapest).toBe('v1');
  });

  it('names no cheapest with one venue or a tie, and no budget figures without a budget', () => {
    const one = venueComparison(cats, [{ id: 'v1', name: 'Barn', amounts: { 'i-site': 5 }, savedAt: '' }], 0, 0, 0);
    expect(one.cheapest).toBeNull();
    expect(one.rows[1].budgeted).toBeNull();
    expect(one.venues[0]).toMatchObject({ diff: null, perPerson: null });
    const tie = venueComparison(cats, [
      { id: 'v1', name: 'A', amounts: { 'i-site': 5 }, savedAt: '' }, { id: 'v2', name: 'B', amounts: { 'i-bar': 5 }, savedAt: '' },
    ], 0);
    expect(tie.cheapest).toBeNull();
    expect(venueComparison(cats, [], 0)).toEqual({ rows: [], venues: [], cheapest: null });
  });
});

describe('included lines and food per person', async () => {
  const { normalizePlan, saveVenueQuote, sameCalc, venueComparison, calculatorTotals, calculatorGroups, isFoodLine } = await import('./weddingBudgetPlan');
  const cats = [
    { id: 'c-venue', name: 'Venue', pct: 0, taxed: true, items: [
      { id: 'i-site', name: 'Site fee', pct: 10, taxed: true, perPlate: null, markup: null },
      { id: 'i-food', name: 'Food (cocktail hour, dinner)', pct: 20, taxed: true, perPlate: null, markup: null },
      { id: 'i-rent', name: 'Rentals', pct: 5, taxed: true, perPlate: null, markup: null },
      { id: 'i-plate', name: 'Late-night snack', pct: 1, taxed: false, perPlate: { price: 10 }, markup: null },
    ] },
  ];

  it('spots food lines by name or by being priced per plate', () => {
    expect(isFoodLine({ name: 'Food (cocktail hour, dinner, vendor meals)' })).toBe(true);
    expect(isFoodLine({ name: 'Catering' })).toBe(true);
    expect(isFoodLine({ name: 'Snack', perPlate: { price: 5 } })).toBe(true);
    expect(isFoodLine({ name: 'Bar and beverages' })).toBe(false);
    expect(isFoodLine({ name: 'Photographer' })).toBe(false);
    expect(calculatorGroups(cats)[0].lines.map((l) => l.food)).toEqual([false, true, false, true]);
  });

  it('counts an included line as answered at no cost', () => {
    const t = calculatorTotals(cats, { 'i-site': 5000, 'i-food': 12000, 'i-rent': 999 }, 10, { 'i-rent': true });
    expect(t).toMatchObject({ subtotal: 17000, tax: 1700, total: 18700, filled: 3, included: 1, food: 12000, foodLines: 1 });
  });

  it('keeps included lines on the calculator and on saved venues, without an amount beside them', () => {
    const plan = normalizePlan({
      calculator: { amounts: { a: 5, b: 7 }, included: { b: true, c: 'yes' } },
      venueQuotes: [{ id: 'v1', name: 'Barn', amounts: { a: 1 }, included: { r: true } }],
    });
    expect(plan.calculator).toEqual({ amounts: { a: 5 }, included: { b: true } });
    expect(plan.venueQuotes[0]).toMatchObject({ amounts: { a: 1 }, included: { r: true } });
    const q = saveVenueQuote([], 'Loft', { amounts: { a: 2 }, included: { r: true } });
    expect(q[0]).toMatchObject({ amounts: { a: 2 }, included: { r: true } });
    expect(saveVenueQuote([], 'Old', { a: 2 })[0]).toMatchObject({ amounts: { a: 2 }, included: {} });
  });

  it('tells two calculators apart by their included lines too', () => {
    expect(sameCalc({ amounts: { a: 1 }, included: { r: true } }, { amounts: { a: 1 }, included: { r: true } })).toBe(true);
    expect(sameCalc({ amounts: { a: 1 }, included: { r: true } }, { amounts: { a: 1 } })).toBe(false);
  });

  it('shows included in the comparison, as the lowest on its line, with food per person', () => {
    const quotes = [
      { id: 'v1', name: 'Barn', amounts: { 'i-site': 5000, 'i-food': 12000, 'i-plate': 500 }, included: { 'i-rent': true }, savedAt: '' },
      { id: 'v2', name: 'Loft', amounts: { 'i-site': 8000, 'i-food': 9000, 'i-rent': 2000 }, included: {}, savedAt: '' },
    ];
    const c = venueComparison(cats, quotes, 0, 0, 100);
    const rent = c.rows.find((r) => r.id === 'i-rent');
    expect(rent).toMatchObject({ amounts: [null, 2000], included: [true, false], low: 0 });
    expect(c.venues[0]).toMatchObject({ filled: 4, included: 1, food: 12500, foodPerPerson: 125, total: 17500 });
    expect(c.venues[1]).toMatchObject({ food: 9000, foodPerPerson: 90 });
    expect(venueComparison(cats, quotes, 0, 0, 0).venues[0].foodPerPerson).toBeNull();
    expect(venueComparison(cats, [{ id: 'v', name: 'X', amounts: { 'i-site': 1 }, included: {}, savedAt: '' }], 0, 0, 100).venues[0].foodPerPerson).toBeNull();
  });
});

describe('per-category totals in the calculator', async () => {
  const { calculatorGroupTotals, venueGroupOf, venueComparison } = await import('./weddingBudgetPlan');
  const cats = [
    { id: 'c-venue', name: 'Venue, catering, bar, rentals', pct: 0, taxed: true, items: [
      { id: 'i-site', name: 'Site fee', pct: 10, taxed: true, perPlate: null, markup: null },
      { id: 'i-food', name: 'Food', pct: 20, taxed: true, perPlate: null, markup: null },
      { id: 'i-bar', name: 'Bar', pct: 5, taxed: false, perPlate: null, markup: null },
      { id: 'i-rent', name: 'Rentals', pct: 5, taxed: true, perPlate: null, markup: null },
    ] },
    { id: 'c-photo', name: 'Photography', pct: 5, taxed: true, items: [] },
  ];
  const amounts = { 'i-site': 8000, 'i-food': 18000, 'i-bar': 4000, 'i-rent': 999, 'c-photo': 5000 };

  it('sums each category, with its tax, leaving included lines at no cost', () => {
    const g = calculatorGroupTotals(cats, amounts, 10, { 'i-rent': true });
    expect(g[0]).toMatchObject({ id: 'c-venue', subtotal: 30000, tax: 2600, total: 32600, filled: 4, priced: 3, lines: 4 });
    expect(g[1]).toMatchObject({ id: 'c-photo', subtotal: 5000, tax: 500, total: 5500, filled: 1, lines: 1 });
    expect(calculatorGroupTotals(cats, {}, 10)[0]).toMatchObject({ subtotal: 0, filled: 0, priced: 0 });
  });

  it('finds the venue category by name', () => {
    expect(venueGroupOf(calculatorGroupTotals(cats, amounts, 10)).id).toBe('c-venue');
    expect(venueGroupOf([{ name: 'Flowers' }])).toBeNull();
    expect(venueGroupOf([{ name: 'Avenue cars' }])).toBeNull();
  });

  it('gives each saved venue its venue-category price per person', () => {
    const quotes = [
      { id: 'v1', name: 'Barn', amounts, included: { 'i-rent': true }, savedAt: '' },
      { id: 'v2', name: 'Loft', amounts: { 'c-photo': 5000 }, included: {}, savedAt: '' },
    ];
    const c = venueComparison(cats, quotes, 10, 0, 100);
    expect(c.venues[0].venuePerPerson).toEqual({ name: 'Venue, catering, bar, rentals', subtotal: 300, total: 326 });
    expect(c.venues[1].venuePerPerson).toBeNull();
    expect(venueComparison(cats, quotes, 10, 0, 0).venues[0].venuePerPerson).toBeNull();
  });
});
