/* Sorting the wedding guest list by a column header.

   - Blanks go last whichever way the column is sorted, so a City sort leads
     with cities, not a wall of empty cells.
   - Text compares the way people read it: case-insensitive, with numbers in
     order ("Table 2" before "Table 10").
   - Ties fall back to last name, then first name, always A→Z, so the order is
     stable instead of whatever the list happened to hold.

   A column's value is a string, a number, or a list of strings compared in
   turn (["Family", "Cousins"] sorts subcategories inside their category).

   The status sink (Pending on top, Confirmed below, Not coming at the bottom)
   is for the default view only — before anyone has picked a header. Picking
   one sorts by that column alone; the Status column does the sinking then. */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const STATUS_RANK = { Confirmed: 2, 'Not coming': 3 };
// Pending first, then no status yet, then Confirmed, then Not coming.
export const statusOrder = (c) => (c?.status === 'Pending' ? 0 : STATUS_RANK[c?.status] || 1);
// The coarse buckets the default view sinks by: undecided rows stay together.
const sinkRank = (c) => STATUS_RANK[c?.status] || 0;

const str = (v) => (v === null || v === undefined ? '' : String(v)).trim();
const parts = (v) => (Array.isArray(v) ? v.map(str) : [str(v)]);
const isBlank = (v) => (typeof v === 'number' ? !Number.isFinite(v) : parts(v).every((p) => !p));

function compareValues(av, bv) {
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  const pa = parts(av);
  const pb = parts(bv);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = collator.compare(pa[i] || '', pb[i] || '');
    if (d) return d;
  }
  return 0;
}

// Two cells that sort as equal (case and spacing aside).
export const sameSortValue = (av, bv) => isBlank(av) === isBlank(bv) && compareValues(av, bv) === 0;

export function compareByName(a, b) {
  return compareValues([a?.lastName, a?.firstName], [b?.lastName, b?.firstName]);
}

/* value(c) gives the cell's sort value. `sinkStatus` puts the status buckets
   ahead of the column. */
export function makeGuestComparator({ value, dir = 'asc', sinkStatus = false }) {
  const sign = dir === 'desc' ? -1 : 1;
  return (a, b) => {
    if (sinkStatus) {
      const d = sinkRank(a) - sinkRank(b);
      if (d) return d;
    }
    const av = value(a);
    const bv = value(b);
    const ab = isBlank(av);
    const bb = isBlank(bv);
    if (ab !== bb) return ab ? 1 : -1;
    if (!ab) {
      const d = compareValues(av, bv);
      if (d) return d * sign;
    }
    return compareByName(a, b);
  };
}
