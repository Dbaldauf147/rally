import { describe, it, expect } from 'vitest';
import { bulkSetField, exportColumns, rowsToTsv, venueExportRows } from './venueBulk';
import { addCustomColumn, autoMapVenueHeaders, cellValue, looksLikeVenueHeader, normalizeColumnConfig, planVenuePaste, sortVenueRows } from './venueTable';
import { normalizeVenue } from './weddingVenues';
import { parsePastedCells } from './weddingGuestImport';

const areas = [{ id: 'bk', name: 'Brooklyn', keywords: ['Bushwick'] }, { id: 'li', name: 'Long Island', keywords: ['Huntington'] }];
const { config, key: custom } = addCustomColumn(normalizeColumnConfig(null), 'Vibe', 'c_vibe');
const venues = [
  normalizeVenue({ id: 'a', name: 'Bogart House', status: 'Replied', location: 'Bushwick, Brooklyn', email: 'hi@bogart.com', phone: '609-290-9919', venueFeeLow: '$18,000', notes: 'Roof\tdeck\n"loft"', toVisit: true, custom: { c_vibe: 'Industrial' } }),
  normalizeVenue({ id: 'b', name: 'Oheka Castle', location: 'Huntington, NY', area: 'bk', lastContactDate: '2026-03-04' }),
  normalizeVenue({ id: 'c', name: 'Nowhere Barn', location: 'Vermont' }),
];
// An export, read back the way an imported file is.
const roundTrip = (rows) => parsePastedCells(rowsToTsv(rows));

describe('exporting venues', () => {
  it('writes every column, hidden ones too, with To visit and the area by name', () => {
    const labels = exportColumns(config, areas).map((c) => c.label);
    expect(labels.slice(0, 2)).toEqual(['Venue', 'To visit']);
    expect(labels).toEqual(expect.arrayContaining(['Website', 'Notes', 'Area', 'Vibe', 'Venue fee low']));
    expect(labels).not.toContain('Emails');
    expect(exportColumns(config, []).map((c) => c.label)).not.toContain('Area');
    const [head, a, b, c] = venueExportRows(venues, config, areas);
    const at = (row, label) => row[head.indexOf(label)];
    expect(at(a, 'To visit')).toBe('Yes');
    expect(at(b, 'To visit')).toBe('No');
    expect(at(a, 'Area')).toBe('Brooklyn'); // matched from the address
    expect(at(b, 'Area')).toBe('Brooklyn'); // picked by hand
    expect(at(c, 'Area')).toBe('');
    expect(at(a, 'Vibe')).toBe('Industrial');
    expect(at(a, 'Venue fee low')).toBe('$18,000');
  });

  it('survives tabs, line breaks and quotes in a cell', () => {
    const rows = venueExportRows(venues, config, areas);
    expect(roundTrip(rows)).toEqual(rows);
  });
});

describe('importing an export', () => {
  const rows = venueExportRows(venues, config, areas);
  const mapping = autoMapVenueHeaders(roundTrip(rows)[0], config.custom);

  it('recognises every heading it wrote', () => {
    expect(looksLikeVenueHeader(rows)).toBe(true);
    expect(mapping).toEqual(exportColumns(config, areas).map((c) => c.key));
    expect(custom).toBe('c_vibe');
  });

  it('changes nothing when nothing was edited', () => {
    const plan = planVenuePaste(venues, roundTrip(rows).slice(1), mapping, { areas });
    expect(plan).toMatchObject({ added: [], updated: [], skipped: 0 });
    expect(plan.list).toEqual(venues);
  });

  it('applies the edits made in the sheet, and adds new rows', () => {
    const sheet = roundTrip(rows);
    const col = (label) => sheet[0].indexOf(label);
    sheet[1][col('Status')] = 'Toured';
    sheet[1][col('To visit')] = 'No';
    sheet[2][col('To visit')] = 'yes';
    sheet[2][col('Area')] = 'Long Island';
    sheet[3][col('Area')] = 'None of these';
    sheet[3][col('Vibe')] = 'Rustic';
    sheet[3][col('Email')] = ''; // blank: left alone
    const extra = sheet[0].map(() => '');
    extra[col('Venue')] = 'The Foundry';
    extra[col('Area')] = 'Narnia'; // not one of the locations: ignored
    const plan = planVenuePaste(venues, [...sheet.slice(1), extra], mapping, { areas, makeId: () => 'new1' });
    expect(plan.updated).toEqual(['Bogart House', 'Oheka Castle', 'Nowhere Barn']);
    expect(plan.added).toEqual(['The Foundry']);
    const [a, b, c, d] = plan.list;
    expect(a).toMatchObject({ id: 'a', status: 'Toured', toVisit: false, area: '', email: 'hi@bogart.com' });
    expect(b).toMatchObject({ toVisit: true, area: 'li' });
    expect(c).toMatchObject({ area: '__none', custom: { c_vibe: 'Rustic' } });
    expect(d).toMatchObject({ id: 'new1', name: 'The Foundry', area: '', toVisit: false });
  });
});

describe('bulkSetField', () => {
  const ids = new Set(['a', 'c']);
  it('sets one field on the ticked venues only', () => {
    const next = bulkSetField(venues, ids, 'status', 'Toured');
    expect(next.map((v) => v.status)).toEqual(['Toured', 'Researching', 'Toured']);
    expect(next[1]).toBe(venues[1]);
    expect(bulkSetField(venues, ids, 'toVisit', 'Yes').map((v) => v.toVisit)).toEqual([true, false, true]);
    expect(bulkSetField(venues, ids, 'toVisit', 'No').map((v) => v.toVisit)).toEqual([false, false, false]);
    expect(bulkSetField(venues, ids, 'hidden', 'Yes').map((v) => v.hidden)).toEqual([true, false, true]);
    expect(bulkSetField(venues, ids, 'area', 'li').map((v) => v.area)).toEqual(['li', 'bk', 'li']);
    expect(bulkSetField(venues, ids, 'c_vibe', 'Garden').map((v) => v.custom.c_vibe)).toEqual(['Garden', undefined, 'Garden']);
    expect(bulkSetField(venues, ids, 'venueFeeLow', '20k').map((v) => v.venueFeeLow)).toEqual(['$20,000', '', '$20,000']);
  });
  it('a blank clears, a venue already there is untouched, and names are never set', () => {
    expect(bulkSetField(venues, ids, 'location', '').map((v) => v.location)).toEqual(['', 'Huntington, NY', '']);
    expect(bulkSetField(venues, ['a'], 'status', 'Replied')[0]).toBe(venues[0]);
    expect(bulkSetField(venues, ids, 'name', 'Same')).toBe(venues);
  });
});

describe('the Why not a fit column', () => {
  const no = normalizeVenue({ id: 'n', name: 'Pricey Hall', status: 'Not a fit', noFitReasons: ['Too expensive', 'Location / too far'], noFitNotes: 'Minimum was double.' });
  const moved = normalizeVenue({ id: 'm', name: 'Second Look', status: 'Replied', noFitReasons: ['Too expensive'] });

  it('sits right after Status, in fresh and saved tables', () => {
    const keys = exportColumns(normalizeColumnConfig(null)).map((c) => c.key);
    expect(keys[keys.indexOf('status') + 1]).toBe('noFit');
    expect(normalizeColumnConfig({ order: ['name', 'status', 'email'], hidden: [] }).order.slice(0, 3)).toEqual(['name', 'status', 'noFit']);
  });

  it('reads as the reasons and notes, only while the venue is Not a fit', () => {
    expect(cellValue(no, 'noFit')).toBe('Too expensive · Location / too far — Minimum was double.');
    expect(cellValue(moved, 'noFit')).toBe('');
    expect(sortVenueRows([moved, no], { key: 'noFit', dir: 'asc' }).map((v) => v.id)).toEqual(['n', 'm']);
  });

  it('exports the reasons and reads them back on import', () => {
    const rows = venueExportRows([no, moved], config, []);
    const col = rows[0].indexOf('Why not a fit');
    expect([rows[1][col], rows[2][col]]).toEqual(['Too expensive · Location / too far', '']);
    const mapping = autoMapVenueHeaders(rows[0], config.custom);
    expect(mapping[col]).toBe('noFit');
    expect(planVenuePaste([no, moved], rows.slice(1), mapping)).toMatchObject({ added: [], updated: [] });
    rows[1][col] = 'Not our style; Too expensive';
    const plan = planVenuePaste([no, moved], rows.slice(1), mapping);
    expect(plan.list[0]).toMatchObject({ noFitReasons: ['Not our style', 'Too expensive'], noFitNotes: 'Minimum was double.', status: 'Not a fit' });
  });
});
