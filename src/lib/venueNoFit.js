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

/* The list of reasons to offer, in its saved order. Once the list has been
   edited it's saved whole as `weddingVenueNoFitReasonList`, and that is the
   list — a starter reason that was removed stays removed. Before then it's
   the starter set, plus reasons typed in earlier (`weddingVenueNoFitReasons`,
   which held only the additions) and any found on a Not-a-fit venue. */
export function noFitReasonList(data, venues) {
  if (Array.isArray(data?.weddingVenueNoFitReasonList)) return normalizeReasonList(data.weddingVenueNoFitReasonList);
  return normalizeReasonList([
    ...DEFAULT_NO_FIT_REASONS,
    ...(Array.isArray(data?.weddingVenueNoFitReasons) ? data.weddingVenueNoFitReasons : []),
    ...(venues || []).flatMap((v) => (v?.status === 'Not a fit' ? v.noFitReasons || [] : [])),
  ]);
}

/* The checkboxes: each reason on the list with how many Not-a-fit venues
   it's on, most-used first, then in list order. */
export function noFitReasonOptions(list, venues) {
  const all = normalizeReasonList(list);
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

/* Renames from editing the list ({ old spelling: new spelling }) applied to
   a venue's reasons. Renaming one reason to another's name merges them.
   A reason removed from the list stays on the venues that have it. */
export function renameReasons(reasons, renames) {
  const byKey = new Map(Object.entries(renames || {}).map(([from, to]) => [reasonKey(from), to]));
  if (!byKey.size) return normalizeReasonList(reasons);
  return normalizeReasonList((reasons || []).map((r) => byKey.get(reasonKey(r)) ?? r));
}

/* An edited list: rows of { from, text } (from = the reason it started as,
   blank for a row added while editing). Blank rows are removals. Returns the
   new list and the renames to carry onto the venues. */
export function applyListEdits(rows) {
  const list = normalizeReasonList(rows.map((r) => r.text));
  const renames = {};
  for (const r of rows) {
    const to = standardReason(r.text, list);
    if (r.from && to && to !== r.from) renames[r.from] = to;
  }
  return { list, renames };
}

/* Bulk edit: one reason added to or taken off every venue whose id is in
   `ids`, or all their reasons cleared. Adding a reason also marks the venue
   Not a fit — that's the only status a reason shows on. Removing or clearing
   leaves the status alone. `known` is the reason list, so a typed reason
   takes the spelling already on it. Venues that don't change are returned
   as the same objects, so the caller can count what changed. */
export const NO_FIT_BULK_MODES = ['add', 'remove', 'clear'];
export function bulkNoFitReasons(venues, ids, mode, reason, known = []) {
  const pick = ids instanceof Set ? ids : new Set(ids || []);
  const r = standardReason(reason, known);
  if (mode !== 'clear' && !r) return venues;
  const k = reasonKey(r);
  return (venues || []).map((v) => {
    if (!pick.has(v.id)) return v;
    const have = v.noFitReasons || [];
    let next = v;
    if (mode === 'add') {
      const reasons = have.some((x) => reasonKey(x) === k) ? have : normalizeReasonList([...have, r]);
      if (reasons !== have || v.status !== 'Not a fit') next = { ...v, status: 'Not a fit', noFitReasons: reasons };
    } else if (mode === 'remove') {
      const reasons = have.filter((x) => reasonKey(x) !== k);
      if (reasons.length !== have.length) next = { ...v, noFitReasons: reasons };
    } else if (mode === 'clear' && have.length) {
      next = { ...v, noFitReasons: [] };
    }
    return next;
  });
}
