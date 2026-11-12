import { describe, it, expect } from 'vitest';
import { NO_AREA, areaName, areaTerms, normalizeAreas, parseKeywords, unmappedVenues, venueArea } from './venueAreas';
import { normalizeVenue } from './weddingVenues';
import { allVenueColumns, normalizeColumnConfig, sortVenueRows, withCellValue } from './venueTable';

const areas = normalizeAreas([
  { id: 'nf', name: 'North Fork', keywords: ['Greenport', 'Southold', 'Shelter Island', '11944'] },
  { id: 'hamptons', name: 'Hamptons', keywords: 'Southampton, Hampton Bays, Montauk' },
  { id: 'eh', name: 'East Hampton', keywords: [] },
  { id: 'mystic', name: 'Mystic, CT', keywords: ['Stonington'] },
  { id: 'nyc', name: 'Brooklyn', keywords: ['Williamsburg', 'NY 11211'] },
]);
const v = (name, location) => normalizeVenue({ id: name, name, location });

describe('the list of locations', () => {
  it('cleans keywords typed with commas, semicolons or lines', () => {
    expect(parseKeywords('Orient, Southold; greenport\nGreenport,,')).toEqual(['Orient', 'Southold', 'greenport']);
  });
  it('drops nameless and duplicate locations', () => {
    expect(normalizeAreas([{ id: 'a', name: 'A' }, { id: 'a', name: 'A again' }, { id: 'b', name: ' ' }]).map((a) => a.name)).toEqual(['A']);
    expect(normalizeAreas(null)).toEqual([]);
  });
  it('a location matches its own name up to the comma', () => {
    expect(areaTerms(areas[3]).map((t) => t.trim())).toEqual(['mystic', 'stonington']);
  });
});

describe('matching venues to them', () => {
  it('matches an address on whole words, ignoring case and punctuation', () => {
    expect(venueArea(v('Sound View', '58855 Route 48, Greenport, NY 11944'), areas)).toMatchObject({ how: 'auto', area: { id: 'nf' }, term: 'greenport' });
    expect(venueArea(v('Boathouse', 'Island Boatyard, Shelter Island Heights'), areas).area.id).toBe('nf');
    expect(venueArea(v('X', '81 Shore Rd, MYSTIC, Conn.'), areas).area.id).toBe('mystic');
    // "Greenporter" isn't Greenport.
    expect(venueArea(v('Y', 'Greenporter Hotel Rd'), areas).how).toBe('unmapped');
  });
  it('the longest keyword wins, so East Hampton beats Hampton Bays… and Hamptons', () => {
    expect(venueArea(v('A', '1 Main St, East Hampton, NY'), areas).area.id).toBe('eh');
    expect(venueArea(v('B', 'Montauk Hwy, Hampton Bays'), areas).area.id).toBe('hamptons');
  });
  it('falls back to the venue name when the address says nothing', () => {
    expect(venueArea(v('Hilton Mystic', ''), areas).area.id).toBe('mystic');
    expect(venueArea(v('Regatta Place', ''), areas).how).toBe('unmapped');
  });
  it('a location picked by hand wins; "none of these" silences the warning', () => {
    expect(venueArea({ ...v('A', 'Greenport'), area: 'nyc' }, areas)).toMatchObject({ how: 'manual', area: { id: 'nyc' } });
    expect(venueArea({ ...v('A', 'Nowhere'), area: NO_AREA }, areas)).toEqual({ area: null, how: 'none' });
    // A pick of a location since deleted falls back to matching.
    expect(venueArea({ ...v('A', 'Greenport'), area: 'gone' }, areas).how).toBe('auto');
  });
  it('lists the venues that need a location, and none when there are no locations', () => {
    const list = [v('A', 'Greenport'), v('B', 'Newport, RI'), { ...v('C', 'Providence'), area: NO_AREA }];
    expect(unmappedVenues(list, areas).map((x) => x.name)).toEqual(['B']);
    expect(unmappedVenues(list, [])).toEqual([]);
    expect(venueArea(list[0], [])).toEqual({ area: null, how: 'off' });
  });
});

describe('the Area column', () => {
  it('sits right after Location, in fresh and saved tables', () => {
    const keys = allVenueColumns(null).map((c) => c.key);
    expect(keys[keys.indexOf('location') + 1]).toBe('area');
    const saved = normalizeColumnConfig({ order: ['name', 'location', 'status'], hidden: [] });
    expect(saved.order.slice(0, 3)).toEqual(['name', 'location', 'area']);
  });
  it('saves a pick on the venue and sorts by the location name', () => {
    expect(withCellValue(v('A', ''), 'area', 'nyc').area).toBe('nyc');
    const list = [v('M', 'Mystic'), v('G', 'Greenport'), v('Z', 'Nowhere')];
    expect(sortVenueRows(list, { key: 'area', dir: 'asc' }, { valueFor: (x) => areaName(x, areas) }).map((x) => x.name)).toEqual(['M', 'G', 'Z']);
  });
});

describe('location pros and cons', () => {
  it('keeps each location\'s pros and cons, trimmed, and they never affect matching', () => {
    const [a] = normalizeAreas([{ id: 'n', name: 'North Fork', keywords: ['Greenport'], pros: '  Wineries\r\nWater views ', cons: 7 }]);
    expect(a).toEqual({ id: 'n', name: 'North Fork', keywords: ['Greenport'], pros: 'Wineries\nWater views', cons: '' });
    expect(normalizeAreas([{ id: 'x', name: 'X' }])[0]).toMatchObject({ pros: '', cons: '' });
    expect(venueArea({ location: 'Wineries Rd' }, [a]).area).toBe(null);
  });
});
