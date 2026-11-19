import { describe, it, expect } from 'vitest';
import { normalizePlan, saveVenueQuote } from './weddingBudgetPlan';
import { parseQuoteCell, planQuoteImport, quoteSheetLines, quoteSheetRows } from './venueQuoteSheet';

const cats = normalizePlan(null).categories;
const lines = quoteSheetLines(cats);
const now = new Date('2026-11-19T12:00:00Z');
const idOf = (re) => lines.find((l) => re.test(l.label)).id;
const site = idOf(/site fee/i);
const food = idOf(/^food/i);
const bar = idOf(/^bar/i);

describe('reading a cell', () => {
  it('knows flat, per person, included and blank', () => {
    expect(parseQuoteCell('$12,000')).toEqual({ amount: 12000 });
    expect(parseQuoteCell('12k')).toEqual({ amount: 12000 });
    expect(parseQuoteCell(9500)).toEqual({ amount: 9500 });
    expect(parseQuoteCell('$250 pp')).toEqual({ perPerson: 250 });
    expect(parseQuoteCell('185 per person')).toEqual({ perPerson: 185 });
    expect(parseQuoteCell('$95/guest')).toEqual({ perPerson: 95 });
    expect(parseQuoteCell('Included')).toEqual({ included: true });
    expect(parseQuoteCell('incl')).toEqual({ included: true });
    expect(parseQuoteCell('  ')).toBeNull();
    expect(parseQuoteCell('call them')).toEqual({ bad: true });
  });
});

describe('the template', () => {
  it('has a Venue column, one per budget line and Availability, every label distinct', () => {
    const { venues } = quoteSheetRows(cats, []);
    expect(venues).toHaveLength(1);
    expect(venues[0][0]).toBe('Venue');
    expect(venues[0].at(-1)).toBe('Availability');
    expect(venues[0].length).toBe(lines.length + 2);
    expect(new Set(venues[0]).size).toBe(venues[0].length);
  });

  it('fills in rows that import as new venues', () => {
    const [head] = quoteSheetRows(cats, []).venues;
    const row = (name, cells) => head.map((h, i) => (i === 0 ? name : cells[h] ?? ''));
    const label = (id) => lines.find((l) => l.id === id).label;
    const plan = planQuoteImport(cats, [], [head,
      row('Stamford Yacht Club', { [label(site)]: '$12,000', [label(food)]: '$300 pp', [label(bar)]: 'Included' }),
      row('Amarante’s Sea Cliff', { [label(site)]: '50000' }),
      row('', { [label(site)]: '1' }),
    ], now);
    expect(plan.added).toEqual(['Stamford Yacht Club', 'Amarante’s Sea Cliff']);
    expect(plan.skipped).toBe(1);
    const s = plan.quotes[0];
    expect(s.amounts[site]).toBe(12000);
    expect(s.perPerson[food]).toBe(300);
    expect(s.included[bar]).toBe(true);
  });
});

describe('downloading and importing again', () => {
  let quotes = saveVenueQuote([], 'Foundry', { amounts: { [site]: 8000 }, perPerson: { [food]: 210 }, included: { [bar]: true } }, now);
  quotes = saveVenueQuote(quotes, 'Bogart', {
    amounts: {}, included: {}, perPerson: {},
    subs: { [food]: [{ id: 's1', name: 'Dinner', amount: 20000 }, { id: 's2', name: 'Raw bar', amount: 4000 }] },
  }, now);
  const { venues: rows } = quoteSheetRows(cats, quotes);

  it('writes each saved venue as a row', () => {
    const at = (r, id) => r[rows[0].indexOf(lines.find((l) => l.id === id).label)];
    expect(rows[1][0]).toBe('Foundry');
    expect(at(rows[1], site)).toBe('$8,000');
    expect(at(rows[1], food)).toBe('$210 per person');
    expect(at(rows[1], bar)).toBe('Included');
    expect(at(rows[2], food)).toBe('$24,000');
  });

  it('changes nothing when imported untouched, sub-items included', () => {
    const plan = planQuoteImport(cats, quotes, rows, now);
    expect(plan.added).toEqual([]);
    expect(plan.updated).toEqual([]);
    expect(plan.unchanged).toEqual(['Foundry', 'Bogart']);
    expect(plan.quotes).toEqual(quotes);
  });

  it('updates only the edited cells, matching names whatever the capitals', () => {
    const edited = rows.map((r) => [...r]);
    edited[1][0] = 'FOUNDRY';
    edited[1][rows[0].indexOf(lines.find((l) => l.id === site).label)] = '9000';
    const plan = planQuoteImport(cats, quotes, edited, now);
    expect(plan.updated).toEqual(['Foundry']);
    const f = plan.quotes.find((q) => q.name === 'Foundry');
    expect(f.amounts[site]).toBe(9000);
    expect(f.perPerson[food]).toBe(210);
    expect(plan.quotes.find((q) => q.name === 'Bogart').subs[food]).toHaveLength(2);
  });
});

describe('a sheet it can’t fully read', () => {
  it('reports unknown headings and unreadable cells, and needs a Venue column', () => {
    const plan = planQuoteImport(cats, [], [['Venue', 'Helicopter', lines[0].label], ['X', '5', 'ask']], now);
    expect(plan.unknown).toEqual(['Helicopter']);
    expect(plan.bad).toEqual([{ venue: 'X', column: lines[0].label, value: 'ask' }]);
    expect(plan.added).toEqual(['X']);
    expect(() => planQuoteImport(cats, [], [['Name of place'], ['X']])).toThrow(/Venue/);
  });
});
