// The records table in the Doctors speciality pop-up: which columns it can
// show, which it shows, how wide each is, and what it's sorted by.
//
// Kept pure so the sorting and the stored preferences can be tested without
// React. The preferences live in localStorage, per device, rather than on the
// shared list: a column dragged wide on a laptop is the wrong width on a
// phone, and hiding one there shouldn't hide it here.

import { STATUS_ORDER } from './doctors.js';

/* Every column the table can carry, in the order they appear when shown.
 *
 * `sort` says how a column compares: text, a rank (status), a number (open
 * questions) or a date. `readOnly` columns are counted, not typed. Widths are
 * pixels, because a column you drag is a width you meant, not a share of
 * whatever the window happens to be. */
export const POPUP_COLUMNS = [
  { key: 'doctor', label: 'Doctor', width: 220, sort: 'text' },
  { key: 'place', label: 'Place', width: 180, sort: 'text' },
  { key: 'issue', label: 'Issue', width: 260, sort: 'text' },
  { key: 'currentMeds', label: 'Current meds', width: 220, sort: 'text' },
  { key: 'previousMeds', label: 'Previous meds', width: 200, sort: 'text' },
  { key: 'notes', label: 'Notes', width: 280, sort: 'text' },
  { key: 'cadence', label: 'Cadence', width: 150, sort: 'text' },
  { key: 'lastVisit', label: 'Last visit', width: 120, sort: 'date', readOnly: true },
  { key: 'nextVisit', label: 'Next visit', width: 120, sort: 'date', readOnly: true },
  { key: 'link', label: 'Link', width: 130, sort: 'text' },
  { key: 'images', label: 'Images', width: 170, sort: 'number', readOnly: true },
  { key: 'status', label: 'Status', width: 140, sort: 'status' },
  { key: 'questions', label: 'Qs', width: 64, sort: 'number', readOnly: true },
];

const COLUMN_BY_KEY = Object.fromEntries(POPUP_COLUMNS.map((c) => [c.key, c]));

// What the table showed before it could be changed, so opening it looks the
// same until you change it.
export const DEFAULT_SHOWN = ['doctor', 'issue', 'currentMeds', 'notes', 'link', 'images', 'status', 'questions'];

// Columns added after preferences started being saved. Saved preferences
// from before a column existed never had the chance to show it, so a default
// one appears for them once; after that `known` records it was offered, and
// hiding it sticks.
const ALL_KEYS = POPUP_COLUMNS.map((c) => c.key);
const ADDED_LATER = ['images'];

export const MIN_WIDTH = 60;
export const MAX_WIDTH = 900;

export const STORAGE_KEY = 'rally.doctors.popupColumns.v1';

/* Stored preferences, cleaned up.
 *
 * Unknown keys dropped (a column retired since), widths clamped, a sort on a
 * column that no longer exists forgotten. An empty `shown` falls back to the
 * defaults rather than leaving a table with no columns and no way to tell why. */
export function normalizePrefs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const saved = (Array.isArray(r.shown) ? r.shown : []).filter((k, i, a) => COLUMN_BY_KEY[k] && a.indexOf(k) === i);
  const known = new Set(Array.isArray(r.known) ? r.known : ALL_KEYS.filter((k) => !ADDED_LATER.includes(k)));
  const shown = saved.length
    ? [...saved, ...DEFAULT_SHOWN.filter((k) => !known.has(k) && !saved.includes(k))]
    : saved;
  const widths = {};
  Object.entries(r.widths && typeof r.widths === 'object' ? r.widths : {}).forEach(([k, w]) => {
    const n = Math.round(Number(w));
    if (COLUMN_BY_KEY[k] && Number.isFinite(n)) widths[k] = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
  });
  const sort = r.sort && COLUMN_BY_KEY[r.sort.key] && (r.sort.dir === 'asc' || r.sort.dir === 'desc')
    ? { key: r.sort.key, dir: r.sort.dir }
    : null;
  return { shown: shown.length ? shown : [...DEFAULT_SHOWN], widths, sort, known: [...ALL_KEYS] };
}

// The shown columns, in catalogue order, each with its width.
export function shownColumns(prefs) {
  const p = normalizePrefs(prefs);
  const on = new Set(p.shown);
  return POPUP_COLUMNS.filter((c) => on.has(c.key)).map((c) => ({ ...c, width: p.widths[c.key] ?? c.width }));
}

// Show or hide one column. The last one showing stays: a table of nothing
// isn't a choice anybody means to make.
export function toggleColumn(prefs, key) {
  const p = normalizePrefs(prefs);
  if (!COLUMN_BY_KEY[key]) return p;
  if (p.shown.includes(key)) {
    if (p.shown.length === 1) return p;
    return { ...p, shown: p.shown.filter((k) => k !== key), sort: p.sort?.key === key ? null : p.sort };
  }
  return { ...p, shown: [...p.shown, key] };
}

export function setColumnWidth(prefs, key, width) {
  const p = normalizePrefs(prefs);
  return normalizePrefs({ ...p, widths: { ...p.widths, [key]: width } });
}

// A header click: ascending, then descending, then back to the table's own order.
export function cycleSort(sort, key) {
  if (!sort || sort.key !== key) return { key, dir: 'asc' };
  if (sort.dir === 'asc') return { key, dir: 'desc' };
  return null;
}

/* The records in the order the header says.
 *
 * `valueOf(entry, key)` supplies what a column holds — the caller knows how a
 * visit date or a question count is worked out. Empty values sort last in both
 * directions, because a column sorted to find the soonest visit is no use with
 * every unscheduled record stacked on top. Ties keep the table's own order. */
export function sortEntries(entries, sort, valueOf) {
  const list = [...(entries || [])];
  const col = sort && COLUMN_BY_KEY[sort.key];
  if (!col) return list;
  const dir = sort.dir === 'desc' ? -1 : 1;
  const rank = (v) => {
    if (col.sort === 'status') { const i = STATUS_ORDER.indexOf(v); return i < 0 ? null : i; }
    if (col.sort === 'number') { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) ? null : n; }
    if (col.sort === 'date') { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
    const s = String(v ?? '').trim();
    return s ? s : null;
  };
  const keyed = list.map((e, i) => ({ e, i, v: rank(valueOf(e, sort.key)) }));
  keyed.sort((a, b) => {
    if (a.v === null && b.v === null) return a.i - b.i;
    if (a.v === null) return 1;
    if (b.v === null) return -1;
    const c = typeof a.v === 'string'
      ? a.v.localeCompare(b.v, undefined, { sensitivity: 'base', numeric: true })
      : a.v - b.v;
    return c * dir || a.i - b.i;
  });
  return keyed.map((k) => k.e);
}
