import { describe, it, expect } from 'vitest';
import {
  normalizeColumnConfig, visibleVenueColumns, toggleColumn, moveColumn, addCustomColumn, removeCustomColumn,
  renameCustomColumn, setColumnWidth, MIN_COL_WIDTH, MAX_COL_WIDTH, cellValue, withCellValue, sortVenueRows, matchStatus, parseVenueDate,
  autoMapVenueHeaders, looksLikeVenueHeader, guessVenueColumns, planVenuePaste, DEFAULT_HIDDEN, venueSearchUrl,
  toggleFavoriteColumn, dropColumn,
} from './venueTable';
import { normalizeVenue, mergeScannedVenues, normalizeAllInclusive, rangesFromText } from './weddingVenues';

const keys = (cols) => cols.map((c) => c.key);

describe('column setup', () => {
  it('starts with the default columns hidden', () => {
    const shown = keys(visibleVenueColumns(undefined));
    expect(shown[0]).toBe('name');
    DEFAULT_HIDDEN.forEach((k) => expect(shown).not.toContain(k));
    expect(shown).toContain('emails');
  });

  it('hides, shows and reorders among the shown columns', () => {
    let c = toggleColumn(undefined, 'status');
    expect(keys(visibleVenueColumns(c))).not.toContain('status');
    c = toggleColumn(c, 'status');
    c = moveColumn(c, 'status', -1);
    expect(keys(visibleVenueColumns(c)).slice(0, 2)).toEqual(['status', 'name']);
    // contactName's right-hand shown neighbour is email, not a hidden column.
    c = moveColumn(normalizeColumnConfig({ hidden: ['email'] }), 'contactName', 1);
    expect(keys(visibleVenueColumns(c)).indexOf('contactName')).toBeGreaterThan(keys(visibleVenueColumns(c)).indexOf('phone'));
    // Off the end does nothing.
    expect(moveColumn(undefined, 'name', -1).order[0]).toBe('name');
  });

  it('never hides every column and drops unknown keys', () => {
    const all = normalizeColumnConfig({}).order;
    const c = normalizeColumnConfig({ hidden: [...all, 'bogus'], order: ['bogus', 'notes'] });
    expect(c.hidden).not.toContain('name');
    expect(c.order[0]).toBe('notes');
    expect(c.order).not.toContain('bogus');
  });

  it('keeps dragged widths, clamped, and forgets ones for gone columns', () => {
    let c = setColumnWidth(undefined, 'name', 333.4);
    expect(visibleVenueColumns(c)[0].width).toBe(333);
    expect(setColumnWidth(c, 'notes', 5).widths.notes).toBe(MIN_COL_WIDTH);
    expect(setColumnWidth(c, 'notes', 9999).widths.notes).toBe(MAX_COL_WIDTH);
    expect(normalizeColumnConfig({ widths: { bogus: 100, price: 'x' } }).widths).toEqual({});
    const { config } = addCustomColumn(c, 'Food', 'c_food');
    expect(removeCustomColumn(setColumnWidth(config, 'c_food', 200), 'c_food').widths).toEqual({ name: 333 });
  });

  it('adds, renames and removes custom columns', () => {
    const { config, key } = addCustomColumn(undefined, 'Catering', 'c_abc');
    expect(key).toBe('c_abc');
    expect(visibleVenueColumns(config).at(-1)).toMatchObject({ key: 'c_abc', label: 'Catering', custom: true });
    expect(renameCustomColumn(config, 'c_abc', 'Food').custom[0].label).toBe('Food');
    const gone = removeCustomColumn(config, 'c_abc');
    expect(gone.custom).toEqual([]);
    expect(gone.order).not.toContain('c_abc');
  });
});

describe('cells', () => {
  it('reads and writes built-in and custom cells', () => {
    let v = normalizeVenue({ id: 'v1', name: 'Barn' });
    v = withCellValue(v, 'c_abc', ' in-house ');
    v = withCellValue(v, 'status', 'toured');
    v = withCellValue(v, 'lastContactDate', '3/4/2026');
    expect(cellValue(v, 'c_abc')).toBe('in-house');
    expect(v.status).toBe('Toured');
    expect(v.lastContactDate).toBe('2026-03-04');
    expect(withCellValue(v, 'status', 'gibberish').status).toBe('Toured');
    expect(withCellValue(v, 'c_abc', '').custom).toEqual({});
  });

  it('keeps stars and custom values through a scan', () => {
    const saved = [normalizeVenue({ id: 'v1', name: 'The Foundry', starred: true, custom: { c_x: 'yes' } })];
    const { list } = mergeScannedVenues(saved, [{ name: 'Foundry', email: 'a@foundry.com', status: 'Replied' }]);
    expect(list[0]).toMatchObject({ starred: true, custom: { c_x: 'yes' }, email: 'a@foundry.com' });
  });

  it('sorts starred first, then by the column, blanks last', () => {
    const list = [
      normalizeVenue({ id: '1', name: 'B', price: '$9,000' }),
      normalizeVenue({ id: '2', name: 'A' }),
      normalizeVenue({ id: '3', name: 'C', price: '$12,000', starred: true }),
      normalizeVenue({ id: '4', name: 'D', price: '$10,000' }),
    ];
    expect(sortVenueRows(list, { key: 'name', dir: 'asc' }).map((v) => v.name)).toEqual(['C', 'A', 'B', 'D']);
    expect(sortVenueRows(list, { key: 'price', dir: 'desc' }).map((v) => v.name)).toEqual(['C', 'D', 'B', 'A']);
  });
});

describe('typed values', () => {
  it('reads statuses and dates the way people write them', () => {
    expect(matchStatus('BOOKED')).toBe('Booked');
    expect(matchStatus('tour scheduled 5/2')).toBe('Tour scheduled');
    expect(matchStatus('passed')).toBe('Not a fit');
    expect(matchStatus('hmm')).toBe('');
    expect(parseVenueDate('2026-3-4')).toBe('2026-03-04');
    expect(parseVenueDate('12/25/26')).toBe('2026-12-25');
    expect(parseVenueDate('Mar 14, 2026')).toBe('2026-03-14');
    expect(parseVenueDate('soon')).toBe('');
    expect(parseVenueDate('13/40/2026')).toBe('');
  });
});

describe('pasting', () => {
  it('maps headers to fields, own columns, or new columns', () => {
    const custom = [{ key: 'c_cat', label: 'Catering' }];
    expect(autoMapVenueHeaders(['Venue Name', 'Coordinator', 'Contact Email', 'Phone #', 'Town', 'Price', 'Max guests', 'Available dates', 'Catering', 'Vibe', ''], custom))
      .toEqual(['name', 'contactName', 'email', 'phone', 'location', 'price', 'capacity', 'availability', 'c_cat', 'new', '']);
    expect(looksLikeVenueHeader([['Venue', 'Email'], ['Barn', 'a@b.com']])).toBe(true);
    expect(looksLikeVenueHeader([['Barn', 'a@barn.com']])).toBe(false);
  });

  it('guesses columns from the values when there is no header', () => {
    expect(guessVenueColumns([['Barn', 'a@barn.com', '(631) 555-1234', 'barn.com', 'Toured', 'lovely'], ['Loft', 'b@loft.com', '631-555-9999', 'www.loft.net', 'Booked', '']]))
      .toEqual(['name', 'email', 'phone', 'website', 'status', 'new']);
  });

  it('adds new venues and fills in the ones already there', () => {
    let n = 0;
    const existing = [normalizeVenue({ id: 'v1', name: 'The Foundry', phone: '111', location: 'Huntington' })];
    const rows = [
      ['Foundry', '', 'Toured', 'yes'],
      ['Oheka Castle', '516-555-0000', 'Inquired', ''],
      ['', '999', '', ''],
      ['Oheka Castle', '', '', 'pool'],
    ];
    const { list, added, updated, skipped } = planVenuePaste(existing, rows, ['name', 'phone', 'status', 'c_x'], { makeId: () => `new${++n}` });
    expect(added).toEqual(['Oheka Castle']);
    expect(updated).toEqual(['The Foundry']);
    expect(skipped).toBe(1);
    expect(list[0]).toMatchObject({ name: 'The Foundry', phone: '111', location: 'Huntington', status: 'Toured', custom: { c_x: 'yes' } });
    expect(list[1]).toMatchObject({ id: 'new1', name: 'Oheka Castle', phone: '516-555-0000', status: 'Inquired', custom: { c_x: 'pool' } });
  });
});

describe('venueSearchUrl', () => {
  it('searches the name plus the location', () => {
    expect(venueSearchUrl({ name: 'The Barn & Co', location: 'Hudson, NY' }))
      .toBe('https://www.google.com/search?q=The%20Barn%20%26%20Co%20Hudson%2C%20NY');
  });
  it('searches the name alone without a location', () => {
    expect(venueSearchUrl({ name: ' Rose Hall ', location: '' })).toBe('https://www.google.com/search?q=Rose%20Hall');
  });
  it('has nothing to search without a name or location', () => {
    expect(venueSearchUrl({ name: '' })).toBeNull();
  });
});

describe('favorite columns and drag-and-drop', () => {
  it('starring pins a column to the left and shows it', () => {
    const c = toggleFavoriteColumn(normalizeColumnConfig(null), 'notes');
    expect(c.favorites).toEqual(['notes']);
    expect(c.order[0]).toBe('notes');
    expect(c.hidden).not.toContain('notes');
    const c2 = toggleFavoriteColumn(c, 'perPersonLow');
    expect(c2.order.slice(0, 2)).toEqual(['notes', 'perPersonLow']);
  });
  it('unstarring drops it just after the starred ones', () => {
    let c = toggleFavoriteColumn(normalizeColumnConfig(null), 'email');
    c = toggleFavoriteColumn(c, 'phone');
    c = toggleFavoriteColumn(c, 'email');
    expect(c.favorites).toEqual(['phone']);
    expect(c.order.slice(0, 2)).toEqual(['phone', 'email']);
  });
  it('a saved order is kept with favorites first', () => {
    const c = normalizeColumnConfig({ order: ['name', 'status', 'price'], favorites: ['price', 'bogus'] });
    expect(c.order.slice(0, 3)).toEqual(['price', 'name', 'status']);
    expect(c.favorites).toEqual(['price']);
  });
  it('dropping moves a column before or after another', () => {
    const c = normalizeColumnConfig(null);
    expect(dropColumn(c, 'email', 'name').order.slice(0, 2)).toEqual(['email', 'name']);
    const after = dropColumn(c, 'name', 'phone', true).order;
    expect(after.indexOf('name')).toBe(after.indexOf('phone') + 1);
  });
  it('dropping among the starred ones stars it, and out of them unstars it', () => {
    const c = toggleFavoriteColumn(normalizeColumnConfig(null), 'price');
    const inFav = dropColumn(c, 'email', 'price', true);
    expect(inFav.favorites).toEqual(['price', 'email']);
    const out = dropColumn(inFav, 'price', 'status');
    expect(out.favorites).toEqual(['email']);
  });
  it('arrows don\'t cross the line between starred and the rest', () => {
    const c = toggleFavoriteColumn(normalizeColumnConfig(null), 'price');
    expect(moveColumn(c, 'price', 1).order).toEqual(c.order);
    expect(moveColumn(c, 'name', -1).order).toEqual(c.order);
  });
  it('a deleted custom column leaves the favorites', () => {
    const { config, key } = addCustomColumn(normalizeColumnConfig(null), 'Region');
    const fav = toggleFavoriteColumn(config, key);
    expect(removeCustomColumn(fav, key).favorites).toEqual([]);
  });
});

describe('pricing columns', () => {
  it('a saved layout gets the four price columns beside Pricing, and Pricing hidden', () => {
    const c = normalizeColumnConfig({ order: ['name', 'price', 'status', 'emails'], hidden: [] });
    expect(c.order.slice(0, 6)).toEqual(['name', 'price', 'venueFeeLow', 'venueFeeHigh', 'perPersonLow', 'perPersonHigh']);
    expect(c.hidden).toEqual(['price']);
    expect(c.v).toBe(2);
    // Showing it again afterwards sticks.
    const shownAgain = toggleColumn(c, 'price');
    expect(normalizeColumnConfig(shownAgain).hidden).not.toContain('price');
  });
  it('a fresh table shows the low/high columns and all-inclusive, not the free text', () => {
    const shown = keys(visibleVenueColumns(null));
    expect(shown).toEqual(expect.arrayContaining(['venueFeeLow', 'venueFeeHigh', 'perPersonLow', 'perPersonHigh', 'allInclusive']));
    expect(shown).not.toContain('price');
  });
  it('a typed price reads as dollars, and a range fills both ends', () => {
    const v = normalizeVenue({ id: '1', name: 'A', venueFeeLow: '', venueFeeHigh: '', perPersonLow: '', perPersonHigh: '' });
    expect(withCellValue(v, 'venueFeeLow', '12.5k').venueFeeLow).toBe('$12,500');
    const r = withCellValue(v, 'perPersonLow', '$145 – $185');
    expect([r.perPersonLow, r.perPersonHigh]).toEqual(['$145', '$185']);
    const h = withCellValue(v, 'venueFeeHigh', '10k to 15k');
    expect([h.venueFeeLow, h.venueFeeHigh]).toEqual(['$10,000', '$15,000']);
    // The other end, already filled, is left alone; nonsense clears the cell.
    const kept = withCellValue({ ...r }, 'perPersonHigh', '200-250');
    expect([kept.perPersonLow, kept.perPersonHigh]).toEqual(['$145', '$250']);
    expect(withCellValue(r, 'perPersonLow', 'tbd').perPersonLow).toBe('');
  });
  it('sorts the price columns by amount, blanks last', () => {
    const list = ['$9,000', '', '$12,000', '$850'].map((p, i) => normalizeVenue({ id: String(i), name: `V${i}`, venueFeeLow: p }));
    expect(sortVenueRows(list, { key: 'venueFeeLow', dir: 'asc' }).map((v) => v.venueFeeLow)).toEqual(['$850', '$9,000', '$12,000', '']);
    expect(sortVenueRows(list, { key: 'venueFeeLow', dir: 'desc' }).map((v) => v.venueFeeLow)).toEqual(['$12,000', '$9,000', '$850', '']);
  });
  it('all-inclusive reads yes/no however it is typed', () => {
    expect(normalizeAllInclusive('yes')).toBe('Yes');
    expect(normalizeAllInclusive('All-inclusive')).toBe('Yes');
    expect(normalizeAllInclusive(true)).toBe('Yes');
    expect(normalizeAllInclusive('n')).toBe('No');
    expect(normalizeAllInclusive('venue only')).toBe('No');
    expect(normalizeAllInclusive('Partly')).toBe('Partly');
    expect(normalizeAllInclusive('')).toBe('');
  });
  it('pasted headers find the price columns', () => {
    expect(autoMapVenueHeaders(['Venue', 'Venue fee', 'Venue fee high', 'Per person', 'Per person max', 'All inclusive?', 'Pricing']))
      .toEqual(['name', 'venueFeeLow', 'venueFeeHigh', 'perPersonLow', 'perPersonHigh', 'allInclusive', 'price']);
  });
  it('a scan fills empty price cells and leaves typed ones alone', () => {
    const mine = normalizeVenue({ id: 'v1', name: 'Foundry', perPersonLow: '$150', venueFeeLow: '', venueFeeHigh: '', perPersonHigh: '' });
    const { list } = mergeScannedVenues([mine], [{ name: 'The Foundry', venueFeeLow: 18000, venueFeeHigh: 22000, perPersonLow: 185, perPersonHigh: 210, allInclusive: 'Yes', status: 'Quote received' }]);
    expect(list[0]).toMatchObject({ venueFeeLow: '$18,000', venueFeeHigh: '$22,000', perPersonLow: '$150', perPersonHigh: '$210', allInclusive: 'Yes' });
  });
});

describe('prices read out of a quote', () => {
  it('splits per-person amounts from the venue fee, adding any admin fee on', () => {
    expect(rangesFromText('$18k site fee + $165/pp')).toEqual({ venueFeeLow: '$18,000', venueFeeHigh: '$18,000', perPersonLow: '$165', perPersonHigh: '$165' });
    expect(rangesFromText('$145–$185 per person')).toMatchObject({ venueFeeLow: '', perPersonLow: '$145', perPersonHigh: '$185' });
    expect(rangesFromText('$12,500 rental, $3,000 admin fee; $150-$210++ pp'))
      .toEqual({ venueFeeLow: '$15,500', venueFeeHigh: '$15,500', perPersonLow: '$150', perPersonHigh: '$210' });
    expect(rangesFromText('Fri $8k, Sat $12k site fee, $175 a person')).toMatchObject({ venueFeeLow: '$8,000', venueFeeHigh: '$12,000', perPersonLow: '$175' });
  });
  it('skips other rates and words with no dollar amount', () => {
    expect(rangesFromText('$90/lane/hr (2-hr min)')).toEqual({ venueFeeLow: '', venueFeeHigh: '', perPersonLow: '', perPersonHigh: '' });
    expect(rangesFromText('Per person, 200 guests')).toEqual({ venueFeeLow: '', venueFeeHigh: '', perPersonLow: '', perPersonHigh: '' });
  });
  it('fills a venue saved before the ranges, once', () => {
    expect(normalizeVenue({ id: 'a', name: 'X', venueFee: '$18,000', perPlate: '$185' })).toMatchObject({ venueFeeLow: '$18,000', perPersonLow: '$185', perPersonHigh: '$185' });
    expect(normalizeVenue({ id: 'b', name: 'Y', price: '$9k site fee + $150/pp' })).toMatchObject({ venueFeeLow: '$9,000', perPersonLow: '$150' });
    // Once the cells are saved — even cleared — the old text isn't read again.
    expect(normalizeVenue({ id: 'c', name: 'Z', price: '$9k', venueFeeLow: '', venueFeeHigh: '', perPersonLow: '', perPersonHigh: '' }).venueFeeLow).toBe('');
  });
});
