import { describe, it, expect } from 'vitest';
import {
  normalizeColumnConfig, visibleVenueColumns, toggleColumn, moveColumn, addCustomColumn, removeCustomColumn,
  renameCustomColumn, setColumnWidth, MIN_COL_WIDTH, MAX_COL_WIDTH, cellValue, withCellValue, sortVenueRows, matchStatus, parseVenueDate,
  autoMapVenueHeaders, looksLikeVenueHeader, guessVenueColumns, planVenuePaste, DEFAULT_HIDDEN, venueSearchUrl,
  toggleFavoriteColumn, dropColumn,
} from './venueTable';
import { normalizeVenue, mergeScannedVenues, normalizeAllInclusive } from './weddingVenues';

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
    const c2 = toggleFavoriteColumn(c, 'perPlate');
    expect(c2.order.slice(0, 2)).toEqual(['notes', 'perPlate']);
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
  it('a saved layout gets them beside Pricing, not on the end', () => {
    const c = normalizeColumnConfig({ order: ['name', 'price', 'status', 'emails'], hidden: [] });
    expect(c.order.slice(0, 5)).toEqual(['name', 'price', 'venueFee', 'perPlate', 'allInclusive']);
  });
  it('a fresh table shows venue price, per plate and all-inclusive', () => {
    const shown = keys(visibleVenueColumns(null));
    expect(shown).toEqual(expect.arrayContaining(['venueFee', 'perPlate', 'allInclusive']));
  });
  it('all-inclusive reads yes/no however it is typed', () => {
    expect(normalizeAllInclusive('yes')).toBe('Yes');
    expect(normalizeAllInclusive('All-inclusive')).toBe('Yes');
    expect(normalizeAllInclusive(true)).toBe('Yes');
    expect(normalizeAllInclusive('n')).toBe('No');
    expect(normalizeAllInclusive('venue only')).toBe('No');
    expect(normalizeAllInclusive('Partly')).toBe('Partly');
    expect(normalizeAllInclusive('')).toBe('');
    expect(withCellValue(normalizeVenue({ id: '1', name: 'A' }), 'allInclusive', 'Y').allInclusive).toBe('Yes');
  });
  it('pasted headers find the new columns', () => {
    expect(autoMapVenueHeaders(['Venue', 'Venue fee', 'Per person', 'All inclusive?', 'Pricing']))
      .toEqual(['name', 'venueFee', 'perPlate', 'allInclusive', 'price']);
  });
  it('a scan fills them in when empty and leaves typed ones alone', () => {
    const mine = normalizeVenue({ id: 'v1', name: 'Foundry', perPlate: '$150 negotiated' });
    const { list } = mergeScannedVenues([mine], [{ name: 'The Foundry', venueFee: '$18,000', perPlate: '$185/pp', allInclusive: 'Yes', status: 'Quote received' }]);
    expect(list[0]).toMatchObject({ venueFee: '$18,000', perPlate: '$150 negotiated', allInclusive: 'Yes' });
  });
});
