/* Why a venue was "Not a fit" — picked from checkboxes rather than typed, so
   the same reason reads the same way on every venue and can be counted.

   A starter set ships with the app. A reason typed in once is saved to the
   user doc (`weddingVenueNoFitReasons`) and offered as a checkbox from then
   on, so the list grows into the couple's own vocabulary. Typing something
   that is already on the list (in any case or spacing) reuses that reason
   instead of adding a near-duplicate. */

export const DEFAULT_NO_FIT_REASONS = [
  'Too expensive',
  'Too small for our guest count',
  'Date not available',
  'Location / too far',
  'Not our style',
  'Catering or vendor restrictions',
  'Didn’t respond',
];

const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
export const reasonKey = (v) => str(v).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// A clean list of reasons: trimmed, no blanks, no duplicates by key (the
// first spelling wins), at most 60 characters each.
export function normalizeReasonList(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const s = str(raw).slice(0, 60);
    const k = reasonKey(s);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

// The spelling already on the list for a typed reason, else the typed text.
export function standardReason(typed, known) {
  const k = reasonKey(typed);
  if (!k) return '';
  return (known || []).find((r) => reasonKey(r) === k) || str(typed).slice(0, 60);
}

/* The checkboxes to offer: the starter set and the saved ones, plus any
   reason found on a venue that isn't on either list. Most-used first, then
   in list order, with how many Not-a-fit venues each is on. */
export function noFitReasonOptions(saved, venues) {
  const all = normalizeReasonList([
    ...DEFAULT_NO_FIT_REASONS,
    ...(Array.isArray(saved) ? saved : []),
    ...(venues || []).flatMap((v) => (v?.status === 'Not a fit' ? v.noFitReasons || [] : [])),
  ]);
  const counts = new Map(all.map((r) => [reasonKey(r), 0]));
  for (const v of venues || []) {
    if (v?.status !== 'Not a fit') continue;
    for (const r of new Set((v.noFitReasons || []).map(reasonKey))) if (counts.has(r)) counts.set(r, counts.get(r) + 1);
  }
  return all
    .map((reason, i) => ({ reason, count: counts.get(reasonKey(reason)), i }))
    .sort((a, b) => b.count - a.count || a.i - b.i)
    .map(({ reason, count }) => ({ reason, count }));
}
