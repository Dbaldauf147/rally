import { describe, it, expect } from 'vitest';
import {
  normalizeColumnConfig, visibleVenueColumns, toggleColumn, moveColumn, addCustomColumn, removeCustomColumn,
  renameCustomColumn, cellValue, withCellValue, sortVenueRows, matchStatus, parseVenueDate,
  autoMapVenueHeaders, looksLikeVenueHeader, guessVenueColumns, planVenuePaste, DEFAULT_HIDDEN,
} from './venueTable';
import { normalizeVenue, mergeScannedVenues } from './weddingVenues';

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
