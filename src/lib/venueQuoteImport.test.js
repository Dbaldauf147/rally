/* Dropping a filled-in venue-pricing-template.xlsx on Budget → Venue cost
   comparison: reading the file, the cells, and merging into saved venues. */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { normalizePlan, saveVenueQuote, venueComparison } from './weddingBudgetPlan';
import { parseQuoteCell, planQuoteImport, quoteSheetLines, quoteSheetRows, readVenueFile, suggestLine } from './venueQuoteSheet';

const now = new Date('2026-11-19T12:00:00Z');
const SITE_FEE = 'Venue site fee (including admin charges)';

// The template's 30 headings, B to AE, as the user's copy has them.
const TEMPLATE_LINES = [
  SITE_FEE, 'Food (cocktail hour, dinner, vendor meals)', 'Bar and beverages', 'Service charge and gratuity',
  'Rentals (tables, chairs, linens, china, glassware)', 'Photographer', 'Videographer', 'Albums and prints',
  'Reception band or DJ', 'Ceremony and cocktail-hour musicians', 'Sound equipment and microphones',
  'Reception centerpieces and arrangements', 'Ceremony flowers (arch, aisle)', 'Lighting, candles, other decor',
  'Personal flowers (bouquets, boutonnieres)', 'Wedding dress', 'Hair and makeup', 'Alterations', 'Suit or tux',
  'Shoes, veil, accessories', 'Planner or coordinator', 'Invitations and reply cards', 'Save-the-dates', 'Postage',
  'Day-of paper (programs, menus, signage)', 'Cake or dessert', 'Guest shuttles', "Couple's car",
  'Officiant and marriage license', 'Contingency',
];

// A plan whose site-fee line carries the template's name — the budget the real template was downloaded from.
const seed = normalizePlan(null).categories;
const cats = seed.map((c) => ({ ...c, items: c.items.map((i) => (i.name === 'Venue site fee' ? { ...i, name: SITE_FEE } : i)) }));
const lines = quoteSheetLines(cats);
const id = (label) => lines.find((l) => l.label === label).id;
const SITE = id(SITE_FEE);
const FOOD = id(TEMPLATE_LINES[1]);
const BAR = id(TEMPLATE_LINES[2]);
const SERVICE = id(TEMPLATE_LINES[3]);
const RENTALS = id(TEMPLATE_LINES[4]);

const YACHT_AVAIL = 'Saturdays in June 2027 open; September 18, 2027 on hold until Dec 1';
const CLIFF_AVAIL = 'No Saturdays left in 2027; Fridays and Sundays May to October 2027';
const pad = (cells) => [...cells, ...Array(30 - cells.length).fill('')];

// The real template (as the app writes it), with the two rows filled in, saved as .xlsx bytes.
function fixtureWorkbook({ categories = cats, sheetName = 'Venues', extraRows = [] } = {}) {
  const { venues, howTo } = quoteSheetRows(categories, []);
  const rows = [venues[0],
    ['Stamford Yacht Club', ...pad(['$12,000', '$60,000', 'Included', '', 'Included']), YACHT_AVAIL],
    ["Amarante's Sea Cliff", ...pad(['$250 per person', 'Included', 'Included', '', 'Included']), CLIFF_AVAIL],
    ...extraRows];
  const wb = XLSX.utils.book_new();
  // The instructions sheet first, so reading "the first sheet" would be wrong.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(howTo), 'How to fill in');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}
const readFixture = (opts) => readVenueFile('venue-pricing-template.xlsx', fixtureWorkbook(opts), XLSX);

describe('the fixture is the real template', () => {
  it('has Venue, the 30 budget lines in order, then Availability', () => {
    const [head] = readFixture();
    expect(head).toEqual(['Venue', ...TEMPLATE_LINES, 'Availability']);
  });
});

describe('reading the file', () => {
  it('reads only the Venues sheet', () => {
    const rows = readFixture();
    expect(rows[1][0]).toBe('Stamford Yacht Club');
    expect(rows).toHaveLength(3);
  });

  it('rejects an Excel file without a Venues sheet', () => {
    expect(() => readFixture({ sheetName: 'Sheet1' })).toThrow(/no “Venues” sheet/);
  });

  it('finds the Venues sheet whatever its capitals and spacing', () => {
    expect(readFixture({ sheetName: ' venues ' })[1][0]).toBe('Stamford Yacht Club');
  });

  it('rejects a file that is neither Excel nor CSV', () => {
    expect(() => readVenueFile('venues.pdf', new Uint8Array([1, 2]), XLSX)).toThrow(/isn’t an Excel \(\.xlsx\) or CSV file/);
    expect(() => readVenueFile('venues.numbers', new Uint8Array([1, 2]), XLSX)).toThrow(/isn’t an Excel/);
  });

  it('reads a CSV as its one table', () => {
    const rows = readVenueFile('venues.csv', `Venue,${SITE_FEE},Availability\nBarn,"$9,000",Fridays\n`, XLSX);
    expect(rows).toEqual([['Venue', SITE_FEE, 'Availability'], ['Barn', '$9,000', 'Fridays']]);
  });

  it('rejects a sheet with no Venue column, or no venue rows', () => {
    expect(() => planQuoteImport(cats, [], [['Place', SITE_FEE], ['Barn', '1']], now)).toThrow(/no “Venue” column/);
    expect(() => planQuoteImport(cats, [], [['Venue', SITE_FEE]], now)).toThrow(/no venues/);
    expect(() => planQuoteImport(cats, [], [['Venue', SITE_FEE], ['', '5'], ['  ', '']], now)).toThrow(/no venues/);
  });
});

describe('reading a cell', () => {
  it('reads each form the template allows', () => {
    expect(parseQuoteCell('$12,000')).toEqual({ amount: 12000 });
    expect(parseQuoteCell('$250 per person')).toEqual({ perPerson: 250 });
    expect(parseQuoteCell('Included')).toEqual({ included: true });
    expect(parseQuoteCell('')).toBeNull();
  });

  it('is tolerant of how people type them', () => {
    expect(parseQuoteCell('  12000  ')).toEqual({ amount: 12000 });
    expect(parseQuoteCell('12,000.50')).toEqual({ amount: 12000.5 });
    expect(parseQuoteCell('$ 1,250.75')).toEqual({ amount: 1250.75 });
    expect(parseQuoteCell(9500)).toEqual({ amount: 9500 });
    expect(parseQuoteCell(9500.25)).toEqual({ amount: 9500.25 });
    expect(parseQuoteCell('250 PER PERSON')).toEqual({ perPerson: 250 });
    expect(parseQuoteCell('$250pp')).toEqual({ perPerson: 250 });
    expect(parseQuoteCell('$250 PP')).toEqual({ perPerson: 250 });
    expect(parseQuoteCell('250/person')).toEqual({ perPerson: 250 });
    expect(parseQuoteCell('$250 / person')).toEqual({ perPerson: 250 });
    expect(parseQuoteCell('$187.50 per guest')).toEqual({ perPerson: 187.5 });
    expect(parseQuoteCell('INCLUDED')).toEqual({ included: true });
    expect(parseQuoteCell(' included ')).toEqual({ included: true });
  });

  it('marks what it can’t read rather than guessing', () => {
    for (const s of ['TBD', 'call for pricing', '$12,000 - $15,000', 'about 5000', '$', 'per person', '-500']) {
      expect(parseQuoteCell(s)).toEqual({ bad: true });
    }
    expect(parseQuoteCell(-5)).toEqual({ bad: true });
  });
});

describe('importing the fixture', () => {
  it('adds both venues with each value form, and never multiplies per-person or adds tax', () => {
    const r = planQuoteImport(cats, [], readFixture(), now);
    expect(r.added).toEqual(['Stamford Yacht Club', "Amarante's Sea Cliff"]);
    expect(r.updated).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(r.bad).toEqual([]);
    const [yacht, cliff] = r.quotes;
    expect(yacht).toMatchObject({ amounts: { [SITE]: 12000, [FOOD]: 60000 }, included: { [BAR]: true, [RENTALS]: true }, perPerson: {}, availability: YACHT_AVAIL });
    expect(cliff).toMatchObject({ amounts: {}, perPerson: { [SITE]: 250 }, included: { [FOOD]: true, [BAR]: true, [RENTALS]: true }, availability: CLIFF_AVAIL });
    expect(yacht.amounts[SERVICE]).toBeUndefined();
    expect(yacht.included[SERVICE]).toBeUndefined();
    // The comparison does the multiplying (and the tax) itself.
    const c = venueComparison(cats, r.quotes, 10, 0, 100);
    const site = c.rows.find((x) => x.id === SITE);
    expect(site.amounts).toEqual([12000, 25000]);
    expect(site.perPerson).toEqual([null, 250]);
    expect(c.venues.map((v) => v.availability)).toEqual([YACHT_AVAIL, CLIFF_AVAIL]);
  });

  it('previews each new venue’s cells', () => {
    const r = planQuoteImport(cats, [], readFixture(), now);
    expect(r.changes['Stamford Yacht Club']).toEqual([
      { column: SITE_FEE, from: '—', to: '$12,000' },
      { column: TEMPLATE_LINES[1], from: '—', to: '$60,000' },
      { column: TEMPLATE_LINES[2], from: '—', to: 'Included' },
      { column: TEMPLATE_LINES[4], from: '—', to: 'Included' },
      { column: 'Availability', from: '—', to: YACHT_AVAIL },
    ]);
    expect(r.changes["Amarante's Sea Cliff"][0]).toEqual({ column: SITE_FEE, from: '—', to: '$250 per person' });
  });
});

describe('merging into saved venues', () => {
  const saved = () => {
    let q = saveVenueQuote([], 'Stamford Yacht Club', { amounts: { [SITE]: 10000, [SERVICE]: 9000, [RENTALS]: 4000 }, included: {}, perPerson: {} }, now);
    q = q.map((x) => ({ ...x, availability: 'Ask again in March' }));
    return q;
  };

  it('updates a venue matched by name whatever its case and spacing', () => {
    const rows = readFixture({ extraRows: [] }).map((r, i) => (i === 1 ? ['  stamford   yacht CLUB ', ...r.slice(1)] : r));
    const r = planQuoteImport(cats, saved(), rows, now);
    expect(r.updated).toEqual(['Stamford Yacht Club']);
    expect(r.added).toEqual(["Amarante's Sea Cliff"]);
    expect(r.quotes).toHaveLength(2);
    const y = r.quotes[0];
    expect(y.name).toBe('Stamford Yacht Club');
    expect(y.amounts[SITE]).toBe(12000);
  });

  it('leaves a value alone where the cell is empty, Availability included', () => {
    const rows = [['Venue', SITE_FEE, TEMPLATE_LINES[3], 'Availability'], ['Stamford Yacht Club', '$12,000', '', '']];
    const r = planQuoteImport(cats, saved(), rows, now);
    const y = r.quotes[0];
    expect(y.amounts[SERVICE]).toBe(9000);
    expect(y.amounts[RENTALS]).toBe(4000);
    expect(y.availability).toBe('Ask again in March');
    expect(r.changes['Stamford Yacht Club']).toEqual([{ column: SITE_FEE, from: '$10,000', to: '$12,000' }]);
  });

  it('shows old → new for every changed cell, including Availability and a switch to Included', () => {
    const r = planQuoteImport(cats, saved(), readFixture(), now);
    expect(r.changes['Stamford Yacht Club']).toEqual([
      { column: SITE_FEE, from: '$10,000', to: '$12,000' },
      { column: TEMPLATE_LINES[1], from: '—', to: '$60,000' },
      { column: TEMPLATE_LINES[2], from: '—', to: 'Included' },
      { column: TEMPLATE_LINES[4], from: '$4,000', to: 'Included' },
      { column: 'Availability', from: 'Ask again in March', to: YACHT_AVAIL },
    ]);
    expect(r.quotes[0].amounts[RENTALS]).toBeUndefined();
    expect(r.quotes[0].included[RENTALS]).toBe(true);
  });

  it('takes a name-only row: a new venue is created, an existing one left as it is', () => {
    const rows = [['Venue', SITE_FEE, 'Availability'], ['The Barn', '', ''], ['Stamford Yacht Club', '', '']];
    const r = planQuoteImport(cats, saved(), rows, now);
    expect(r.added).toEqual(['The Barn']);
    expect(r.unchanged).toEqual(['Stamford Yacht Club']);
    expect(r.quotes.find((q) => q.name === 'The Barn')).toMatchObject({ amounts: {}, included: {}, perPerson: {}, availability: '' });
    expect(r.changes['The Barn']).toEqual([]);
  });

  it('takes a row with a name and only Availability', () => {
    const rows = [['Venue', SITE_FEE, 'Availability'], ['Stamford Yacht Club', '', 'June open'], ['The Barn', '', 'Fridays only']];
    const r = planQuoteImport(cats, saved(), rows, now);
    expect(r.updated).toEqual(['Stamford Yacht Club']);
    expect(r.added).toEqual(['The Barn']);
    expect(r.quotes[0]).toMatchObject({ availability: 'June open', amounts: { [SITE]: 10000 } });
    expect(r.quotes[1].availability).toBe('Fridays only');
  });

  it('lets the later row win per cell when a venue is listed twice', () => {
    const rows = [['Venue', SITE_FEE, TEMPLATE_LINES[1], 'Availability'],
      ['The Barn', '$5,000', '$100 pp', 'June'],
      ['the barn ', '$6,000', '', '']];
    const r = planQuoteImport(cats, [], rows, now);
    expect(r.added).toEqual(['The Barn']);
    expect(r.quotes).toHaveLength(1);
    expect(r.quotes[0]).toMatchObject({ amounts: { [SITE]: 6000 }, perPerson: { [FOOD]: 100 }, availability: 'June' });
  });

  it('reports a cell it can’t read with venue, column and raw text, and imports the rest', () => {
    const rows = [['Venue', SITE_FEE, TEMPLATE_LINES[1]], ['Stamford Yacht Club', 'TBD', '$60,000']];
    const r = planQuoteImport(cats, saved(), rows, now);
    expect(r.bad).toEqual([{ venue: 'Stamford Yacht Club', column: SITE_FEE, value: 'TBD' }]);
    expect(r.quotes[0].amounts[SITE]).toBe(10000);
    expect(r.quotes[0].amounts[FOOD]).toBe(60000);
  });

  it('changes nothing in the venues it was handed', () => {
    const before = saved();
    const copy = structuredClone(before);
    planQuoteImport(cats, before, readFixture(), now);
    expect(before).toEqual(copy);
  });
});

describe('headings that match no budget line', () => {
  it('skips the column and lists it', () => {
    const rows = [['Venue', 'Helicopter', ` ${SITE_FEE.toUpperCase()} `], ['Barn', '$5,000', '$9,000']];
    const r = planQuoteImport(cats, [], rows, now);
    expect(r.unknown).toEqual(['Helicopter']);
    expect(r.quotes[0].amounts).toEqual({ [SITE]: 9000 });
    expect(r.columns.find((c) => c.header === 'Helicopter')).toMatchObject({ kind: 'unknown', id: null, suggestion: null });
  });

  it('suggests the line the template’s site-fee heading means on a budget that calls it “Venue site fee”', () => {
    const seedLines = quoteSheetLines(seed);
    const siteId = seedLines.find((l) => l.label === 'Venue site fee').id;
    expect(suggestLine(SITE_FEE, seedLines)).toBe(siteId);
    expect(suggestLine('Helicopter', seedLines)).toBeNull();
    const r = planQuoteImport(seed, [], readFixture(), now);
    expect(r.unknown).toEqual([SITE_FEE]);
    expect(r.columns.find((c) => c.header === SITE_FEE)).toMatchObject({ kind: 'unknown', suggestion: siteId });
    expect(r.quotes[0].amounts[siteId]).toBeUndefined();
  });

  it('imports a column once it is mapped to a line, and skips it when mapped to nothing', () => {
    const seedLines = quoteSheetLines(seed);
    const siteId = seedLines.find((l) => l.label === 'Venue site fee').id;
    const rows = readFixture();
    const at = rows[0].indexOf(SITE_FEE);
    const r = planQuoteImport(seed, [], rows, now, { mapping: { [at]: siteId } });
    expect(r.unknown).toEqual([]);
    expect(r.columns.find((c) => c.index === at)).toMatchObject({ kind: 'mapped', id: siteId });
    expect(r.quotes[0].amounts[siteId]).toBe(12000);
    expect(r.quotes[1].perPerson[siteId]).toBe(250);
    expect(planQuoteImport(seed, [], rows, now, { mapping: { [at]: '' } }).unknown).toEqual([SITE_FEE]);
    expect(planQuoteImport(seed, [], rows, now, { mapping: { [at]: 'no-such-line' } }).unknown).toEqual([SITE_FEE]);
  });
});
