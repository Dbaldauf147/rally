/* Wedding → Venues, many at a time: the sheet an export writes, reading a
   file back in, and one change applied to every ticked row.

   An export and an import are a round trip: the headings an export writes
   are the ones an import recognises (lib/venueTable.js), so a sheet can be
   exported, edited in Excel or Google Sheets and imported again to update
   the same venues. Pure, so it can be tested without React. */

import { allVenueColumns, cellValue, withCellValue } from './venueTable.js';
import { areaName } from './venueAreas.js';
import { VENUE_STATUSES, reachedCell } from './weddingVenues.js';

export const TO_VISIT = { key: 'toVisit', label: 'To visit' };
export const HIDDEN = { key: 'hidden', label: 'Hidden' };
export const REACHED_OUT = { key: 'reachedOut', label: 'Reached out' };
const yesNo = (b) => (b ? 'Yes' : 'No');

/* The columns of an export: every column of the table, shown or not, in
   table order, with "To visit" and "Reached out" after the venue's name. The count of emails
   isn't a thing you can edit, so it's left out; Area only when there are
   locations to name. */
export function exportColumns(config, areas = []) {
  const cols = allVenueColumns(config)
    .filter((c) => c.key !== 'emails' && (c.key !== 'area' || areas.length > 0))
    .map((c) => ({ key: c.key, label: c.label }));
  const at = cols.findIndex((c) => c.key === 'name');
  cols.splice(at + 1, 0, TO_VISIT, REACHED_OUT);
  return cols;
}

// The sheet as rows of text: the headings, then one row per venue.
export function venueExportRows(venues, config, areas = []) {
  const cols = exportColumns(config, areas);
  // Why not a fit is written as the reasons alone, so an import can read them back.
  const value = (v, key) => (key === 'toVisit' ? yesNo(v.toVisit) : key === 'reachedOut' ? reachedCell(v) : key === 'area' ? areaName(v, areas)
    : key === 'noFit' ? (v.status === 'Not a fit' ? (v.noFitReasons || []).join(' · ') : '') : cellValue(v, key));
  return [cols.map((c) => c.label), ...(venues || []).map((v) => cols.map((c) => value(v, c.key)))];
}

/* Rows read from a file, as the tab-separated text a paste would have been,
   so a file goes through the same "where does each column go" step. A cell
   holding a tab, a line break or a quote is quoted the way a spreadsheet
   copies it. */
export function rowsToTsv(rows) {
  const cell = (c) => {
    const s = c === null || c === undefined ? '' : String(c);
    return /["\t\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (rows || []).map((r) => (Array.isArray(r) ? r : []).map(cell).join('\t')).join('\n');
}

/* One field set to one value on every venue whose id is in `ids`. "To visit"
   and "Hidden" are yes/no; anything else is a cell of the table, cleaned the
   way a typed cell is (a blank clears it — but never a venue's name). */
export function bulkSetField(venues, ids, key, value) {
  const pick = ids instanceof Set ? ids : new Set(ids || []);
  if (key === 'name') return venues;
  return (venues || []).map((v) => {
    if (!pick.has(v.id)) return v;
    const yes = value === true || value === 'Yes';
    const next = key === 'toVisit' || key === 'hidden' ? { ...v, [key]: yes }
      : withCellValue(v, key, value === true ? 'Yes' : value);
    return JSON.stringify(next) === JSON.stringify(v) ? v : next;
  });
}

/* Email drafts for the ticked venues: which get one. A venue with no email
   address can't be drafted to, and one already reached out to is left alone
   unless asked for (a second "hello, we're getting married" isn't wanted).
   Returns [{ venue, state }] in the order given, state being 'ready',
   'noEmail' or 'reached'. */
export function bulkDraftPlan(venues, { skipReached = true } = {}) {
  return (venues || []).map((venue) => ({
    venue,
    state: !String(venue?.email || '').includes('@') ? 'noEmail'
      : skipReached && venue.reachedOut ? 'reached' : 'ready',
  }));
}

/* A blank sheet for adding many venues at once: the headings an export
   writes (so an import maps every column by itself), with no rows. Area is
   left off — it's worked out from Location, not typed. A second sheet says
   what goes in each column; an import only reads the first. */
const TEMPLATE_HINTS = {
  name: 'Required. The venue’s name — a row without one is skipped. A name already on your list updates that venue.',
  toVisit: 'Yes or No — flags it as a place to visit.',
  reachedOut: 'Yes, No, Emailed or Website.',
  status: `One of: ${VENUE_STATUSES.join(', ')}. Blank means Researching.`,
  email: 'Also used to match a venue already on your list.',
  website: 'Full link, e.g. https://example.com',
  mapsUrl: 'A Google Maps link to the venue.',
  location: 'Town, city or address — the Area is worked out from it.',
  price: 'Pricing as the venue describes it, in words.',
  venueFeeLow: 'Dollars, e.g. 12000 or $12,000.',
  venueFeeHigh: 'Dollars.',
  perPersonLow: 'Dollars per guest.',
  perPersonHigh: 'Dollars per guest.',
  allInclusive: 'Yes or No.',
  capacity: 'Most guests it holds, e.g. 180.',
  availableDates: 'Dates it’s free, separated by semicolons, e.g. Jun 12, 2027; Jun 19, 2027.',
  lastContactDate: 'A date, e.g. 2026-11-18.',
  noFit: 'Only for a venue that’s Not a fit: the reasons, separated by " · ".',
  statusDate: 'Leave blank: Rally fills in the day the status changes.',
};

export function venueTemplateSheets(config) {
  const cols = exportColumns(config, []);
  return {
    venues: [cols.map((c) => c.label)],
    howTo: [
      ['Column', 'What to put in it'],
      ...cols.map((c) => [c.label, TEMPLATE_HINTS[c.key] || (c.key.startsWith('c_') ? 'Your own column.' : 'Optional.')]),
      [],
      ['', 'Fill in one venue per row on the Venues sheet, then Wedding → Venues → Import → Choose a file. Blank cells are fine.'],
    ],
  };
}
