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

/* Categories: a reason can have sub-reasons under it. A sub-reason is kept as
   "Category › Sub-reason", so every list, count and bulk edit still deals in
   plain strings. On a venue, the category alone means all of it; some of its
   sub-reasons mean just those. */
export const SUB_SEP = ' › ';
const MAX_PART = 60;

const str1 = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
// One reason, cleaned: each part trimmed and capped, an empty part dropped.
const str = (v) => {
  const parts = str1(v).split(/\s*›\s*/).map((p) => p.slice(0, MAX_PART).trim()).filter(Boolean);
  return parts.length ? [parts[0], parts.slice(1).join(' ')].filter(Boolean).join(SUB_SEP) : '';
};
const partKey = (v) => v.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const reasonKey = (v) => str(v).split(SUB_SEP).map(partKey).join(' > ');

/** "Too expensive › Venue fee" → ['Too expensive', 'Venue fee']; a category → [it, null]. */
export function splitReason(r) {
  const [cat, sub] = str(r).split(SUB_SEP);
  return [cat || '', sub || null];
}
export const subReason = (category, sub) => str(`${category}${SUB_SEP}${sub}`);

// A clean list of reasons: trimmed, no blanks, no duplicates by key (the
// first spelling wins), each part at most 60 characters.
export function normalizeReasonList(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const s = str(raw);
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
  return (known || []).find((r) => reasonKey(r) === k) || str(typed);
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
      // A whole category takes the place of its sub-reasons, and a sub-reason
      // adds nothing to a venue that already has its whole category.
      const [cat, sub] = splitReason(r);
      const covered = have.some((x) => reasonKey(x) === k) || (sub && have.some((x) => reasonKey(x) === reasonKey(cat)));
      const kept = sub ? have : have.filter((x) => reasonKey(splitReason(x)[0]) !== reasonKey(cat) || !splitReason(x)[1]);
      const reasons = covered ? have : normalizeReasonList([...kept, r]);
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

/* ── Categories and sub-reasons ── */

/* The checkbox options as a tree: each category once, where it first comes
   in the (most-used-first) options, with its sub-reasons under it in list
   order. A sub-reason whose category isn't an option itself still gets one.
   A category's count is the venues with it or any of its sub-reasons. */
export function reasonTree(options) {
  const nodes = [];
  const byKey = new Map();
  const nodeFor = (cat) => {
    const k = reasonKey(cat);
    if (!byKey.has(k)) {
      const n = { reason: cat, count: 0, children: [], implied: true };
      byKey.set(k, n);
      nodes.push(n);
    }
    return byKey.get(k);
  };
  for (const o of options || []) {
    const [cat, sub] = splitReason(o.reason);
    if (!cat) continue;
    const n = nodeFor(cat);
    if (sub) n.children.push({ ...o });
    else Object.assign(n, { ...o, reason: n.implied ? o.reason : n.reason, children: n.children, implied: false });
  }
  return nodes.map((n) => ({ ...n, count: Math.max(n.count || 0, ...n.children.map((c) => c.count || 0)) }));
}

/* How much of a category a set of checked reasons (a Map of key → spelling)
   covers: 'all' (the category itself, or every sub-reason), 'some', 'none'. */
export function categoryState(node, checked) {
  if (checked.has(reasonKey(node.reason))) return 'all';
  const n = node.children.filter((c) => checked.has(reasonKey(c.reason))).length;
  if (!n) return 'none';
  return n === node.children.length ? 'all' : 'some';
}

const withoutCategory = (checked, node) => {
  const next = new Map(checked);
  next.delete(reasonKey(node.reason));
  for (const c of node.children) next.delete(reasonKey(c.reason));
  return next;
};

// Ticking a category takes all of it (stored as the category alone);
// unticking it clears it and every sub-reason.
export function toggleCategory(checked, node) {
  const next = withoutCategory(checked, node);
  if (categoryState(node, checked) !== 'all') next.set(reasonKey(node.reason), node.reason);
  return next;
}

// Ticking a sub-reason keeps exactly what's ticked, so the detail is never
// lost: ticking every one still saves each of them (the category box reads
// as fully ticked). Unticking one from a whole category leaves the rest.
export function toggleSubReason(checked, node, child) {
  const k = reasonKey(child.reason);
  if (checked.has(reasonKey(node.reason))) {
    const next = withoutCategory(checked, node);
    for (const c of node.children) if (reasonKey(c.reason) !== k) next.set(reasonKey(c.reason), c.reason);
    return next;
  }
  const next = new Map(checked);
  if (next.has(k)) next.delete(k); else next.set(k, child.reason);
  return next;
}

/* A venue's reasons for reading: sub-reasons gathered under their category.
   ['Too expensive › Venue fee', 'Too expensive › Per person', 'Date not
   available'] → "Too expensive: Venue fee, Per person · Date not available". */
export function formatReasons(reasons, sep = ' · ') {
  const groups = [];
  const at = new Map();
  for (const r of normalizeReasonList(reasons)) {
    const [cat, sub] = splitReason(r);
    const k = reasonKey(cat);
    if (!at.has(k)) { at.set(k, { cat, subs: [], whole: false }); groups.push(at.get(k)); }
    if (sub) at.get(k).subs.push(sub); else at.get(k).whole = true;
  }
  return groups.map((g) => (g.subs.length && !g.whole ? `${g.cat}: ${g.subs.join(', ')}` : g.cat)).join(sep);
}
