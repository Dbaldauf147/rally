/* The Wedding → Venues table as a spreadsheet: which columns it shows and in
   what order, columns you add yourself, sorting, and pasting a range of cells
   in from Sheets or Excel.

   The column setup is kept on the user doc as `weddingVenueColumns`:
     { order: [key…], hidden: [key…], custom: [{ key, label }…], widths: { key: px },
       favorites: [key…] }
   Favorite (starred) columns are pinned: they always lead the order, so they
   sit at the left of the table and the top of the column picker.
   A custom column's values live on each venue under `custom[key]`. Pure, so it
   can be tested without React. */

import {
  MONEY_KEYS, VENUE_FIELDS, VENUE_STATUSES, cleanMoney, formatMoney, normalizeAllInclusive, normalizeVenue, parseMoney, parseMoneyRange,
  sameVenue, sortVenues,
} from './weddingVenues.js';

// Every built-in column, in the order a fresh table shows them. `emails` is
// the Gmail threads a scan found, so it's counted, not typed.
export const BUILTIN_COLUMNS = [
  ...VENUE_FIELDS.map((f) => ({ ...f })),
  { key: 'emails', label: 'Emails', readOnly: true },
];
const BUILTIN_KEYS = BUILTIN_COLUMNS.map((c) => c.key);

// Starting widths in pixels, before a column is dragged. A dragged width is
// kept per column, clamped so it can't vanish or swallow the screen.
export const MIN_COL_WIDTH = 60;
export const MAX_COL_WIDTH = 800;
const DEFAULT_WIDTHS = { name: 200, status: 140, email: 210, website: 180, lastContactDate: 140, emails: 100, venueFeeLow: 150, venueFeeHigh: 155, perPersonLow: 155, perPersonHigh: 160, allInclusive: 120 };
export function defaultColumnWidth(col) {
  return DEFAULT_WIDTHS[col?.key] || (col?.wide ? 230 : 160);
}
const clampWidth = (w) => Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.round(w)));

// What a fresh table leaves out, so it opens about as wide as it used to.
// The free-text pricing is there to read in a venue's pop-up; the table shows
// the four price columns instead.
export const DEFAULT_HIDDEN = ['website', 'price', 'capacity', 'availability', 'notes'];

// Bumped when a saved setup needs a one-off change: v2 hides the free-text
// Pricing column, which the low/high price columns replaced.
const CONFIG_VERSION = 2;

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const isCustomKey = (k) => /^c_[a-z0-9]+$/.test(k);

export function newCustomKey() {
  return `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/* Saved setup, cleaned: unknown keys dropped, columns that didn't exist when
   it was saved added on the end (shown), and at least the name column left
   showing so the table never ends up blank with no way to tell why. */
export function normalizeColumnConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const custom = (Array.isArray(r.custom) ? r.custom : [])
    .map((c) => ({ key: str(c?.key), label: str(c?.label) }))
    .filter((c) => isCustomKey(c.key) && c.label && !seen.has(c.key) && seen.add(c.key));
  const all = [...BUILTIN_KEYS, ...custom.map((c) => c.key)];
  const valid = new Set(all);
  const order = (Array.isArray(r.order) ? r.order : []).filter((k, i, a) => valid.has(k) && a.indexOf(k) === i);
  // A built-in column that's newer than the saved setup goes in beside the
  // one it follows in a fresh table (Per plate after Venue price after
  // Pricing); anything else goes on the end.
  for (const k of all) {
    if (order.includes(k)) continue;
    const bi = BUILTIN_KEYS.indexOf(k);
    const prev = bi > 0 ? BUILTIN_KEYS.slice(0, bi).reverse().find((x) => order.includes(x)) : null;
    if (prev) order.splice(order.indexOf(prev) + 1, 0, k);
    else order.push(k);
  }
  const favorites = (Array.isArray(r.favorites) ? r.favorites : []).filter((k, i, a) => valid.has(k) && a.indexOf(k) === i);
  // Favorites lead, in the order they sit in `order`.
  const favSet = new Set(favorites);
  const ordered = [...order.filter((k) => favSet.has(k)), ...order.filter((k) => !favSet.has(k))];
  order.splice(0, order.length, ...ordered);
  let hidden = Array.isArray(r.hidden)
    ? r.hidden.filter((k, i, a) => valid.has(k) && a.indexOf(k) === i)
    : [...DEFAULT_HIDDEN];
  if (Array.isArray(r.hidden) && !(r.v >= 2) && !hidden.includes('price')) hidden.push('price');
  if (hidden.length >= order.length) hidden = hidden.filter((k) => k !== 'name');
  const widths = {};
  Object.entries(r.widths && typeof r.widths === 'object' ? r.widths : {}).forEach(([k, w]) => {
    const n = Number(w);
    if (valid.has(k) && Number.isFinite(n)) widths[k] = clampWidth(n);
  });
  return { v: CONFIG_VERSION, order, hidden, custom, widths, favorites: order.filter((k) => favSet.has(k)) };
}

export function setColumnWidth(config, key, width) {
  const c = normalizeColumnConfig(config);
  return normalizeColumnConfig({ ...c, widths: { ...c.widths, [key]: width } });
}

// Every column (shown or not) in table order, each { key, label, custom?, hidden, favorite }.
export function allVenueColumns(config) {
  const c = normalizeColumnConfig(config);
  const byKey = new Map([...BUILTIN_COLUMNS, ...c.custom.map((x) => ({ ...x, custom: true }))].map((x) => [x.key, x]));
  const hidden = new Set(c.hidden);
  const fav = new Set(c.favorites);
  return c.order.map((k) => {
    const col = byKey.get(k);
    return { ...col, hidden: hidden.has(k), favorite: fav.has(k), width: c.widths[k] ?? defaultColumnWidth(col) };
  });
}

export const visibleVenueColumns = (config) => allVenueColumns(config).filter((c) => !c.hidden);

export function toggleColumn(config, key) {
  const c = normalizeColumnConfig(config);
  const hidden = c.hidden.includes(key) ? c.hidden.filter((k) => k !== key) : [...c.hidden, key];
  return normalizeColumnConfig({ ...c, hidden });
}

/* Starring a column pins it: it joins the end of the favorites (so it's
   shown, at the left of the table). Unstarring drops it just after them. */
export function toggleFavoriteColumn(config, key) {
  const c = normalizeColumnConfig(config);
  if (!c.order.includes(key)) return c;
  const isFav = c.favorites.includes(key);
  const rest = c.order.filter((k) => k !== key);
  const favs = c.favorites.filter((k) => k !== key);
  // Either way it sits at the line between the starred and the rest.
  const order = [...favs, key, ...rest.slice(favs.length)];
  return normalizeColumnConfig({
    ...c,
    order,
    favorites: isFav ? favs : [...favs, key],
    hidden: isFav ? c.hidden : c.hidden.filter((k) => k !== key),
  });
}

/* Dragging a column in the picker and dropping it on another: it lands just
   before (or, with `after`, just after) that one. Dropped among the starred
   columns it becomes one; dragged out of them it stops being one. */
export function dropColumn(config, key, targetKey, after = false) {
  const c = normalizeColumnConfig(config);
  if (key === targetKey || !c.order.includes(key) || !c.order.includes(targetKey)) return c;
  const order = c.order.filter((k) => k !== key);
  order.splice(order.indexOf(targetKey) + (after ? 1 : 0), 0, key);
  // It joins whichever group it was dropped on.
  const favSet = new Set(c.favorites.filter((k) => k !== key));
  if (favSet.has(targetKey)) favSet.add(key);
  return normalizeColumnConfig({ ...c, order, favorites: order.filter((k) => favSet.has(k)) });
}

// Moves a column one place left (-1) or right (+1) among the shown ones, so a
// click always visibly moves it rather than hopping past hidden columns.
export function moveColumn(config, key, dir) {
  const c = normalizeColumnConfig(config);
  const hidden = new Set(c.hidden);
  const shown = c.order.filter((k) => !hidden.has(k));
  const at = shown.indexOf(key);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= shown.length) return c;
  const other = shown[to];
  // Pinned columns stay ahead of the rest, so an arrow can't cross that line.
  if (c.favorites.includes(key) !== c.favorites.includes(other)) return c;
  const order = c.order.map((k) => (k === key ? other : k === other ? key : k));
  return normalizeColumnConfig({ ...c, order });
}

export function addCustomColumn(config, label, key = newCustomKey()) {
  const c = normalizeColumnConfig(config);
  const name = str(label) || 'New column';
  return { config: normalizeColumnConfig({ ...c, custom: [...c.custom, { key, label: name }], order: [...c.order, key] }), key };
}

export function renameCustomColumn(config, key, label) {
  const c = normalizeColumnConfig(config);
  const name = str(label);
  if (!name) return c;
  return normalizeColumnConfig({ ...c, custom: c.custom.map((x) => (x.key === key ? { ...x, label: name } : x)) });
}

export function removeCustomColumn(config, key) {
  const c = normalizeColumnConfig(config);
  const widths = { ...c.widths };
  delete widths[key];
  return normalizeColumnConfig({
    order: c.order.filter((k) => k !== key),
    hidden: c.hidden.filter((k) => k !== key),
    custom: c.custom.filter((x) => x.key !== key),
    favorites: c.favorites.filter((k) => k !== key),
    widths,
  });
}

/* ── Cells ── */

// A Google search for the venue, with its location when known so a common
// name ("The Barn") finds the right place.
export function venueSearchUrl(v) {
  const q = [v?.name, v?.location].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
  return q ? `https://www.google.com/search?q=${encodeURIComponent(q)}` : null;
}

export function cellValue(v, key) {
  if (isCustomKey(key)) return str(v?.custom?.[key]);
  if (key === 'emails') return v?.threadIds?.length ? String(v.threadIds.length) : '';
  return typeof v?.[key] === 'string' ? v[key] : '';
}

// A venue with one cell changed, cleaned the way it'll be saved.
export function withCellValue(v, key, value) {
  if (key === 'emails') return v;
  if (isCustomKey(key)) {
    const custom = { ...(v.custom || {}) };
    const s = str(value);
    if (s) custom[key] = s;
    else delete custom[key];
    return normalizeVenue({ ...v, custom });
  }
  if (key === 'status') return normalizeVenue({ ...v, status: matchStatus(value) || v.status });
  if (MONEY_KEYS.includes(key)) {
    // A range typed or pasted into either end ("$10k–$15k") fills both,
    // unless the other end already has something.
    const range = parseMoneyRange(value);
    const isLow = key.endsWith('Low');
    const other = isLow ? key.replace(/Low$/, 'High') : key.replace(/High$/, 'Low');
    const next = { ...v, [key]: range ? formatMoney(isLow ? range[0] : range[1]) : cleanMoney(value) };
    if (range && range[0] !== range[1] && !v[other]) next[other] = formatMoney(isLow ? range[1] : range[0]);
    return normalizeVenue(next);
  }
  if (key === 'allInclusive') return normalizeVenue({ ...v, allInclusive: normalizeAllInclusive(value) });
  if (key === 'lastContactDate') return normalizeVenue({ ...v, lastContactDate: value ? parseVenueDate(value) : '' });
  return normalizeVenue({ ...v, [key]: value });
}

/* Starred venues first, then by the clicked column (blanks last either way),
   or the usual newest-contact-first when nothing's been clicked. */
export function sortVenueRows(list, sort) {
  const base = sort?.key ? [...(list || [])] : sortVenues(list);
  const dir = sort?.dir === 'desc' ? -1 : 1;
  const statusRank = (s) => VENUE_STATUSES.indexOf(s);
  if (sort?.key) {
    base.sort((a, b) => {
      if (sort.key === 'status') return dir * (statusRank(a.status) - statusRank(b.status));
      if (MONEY_KEYS.includes(sort.key)) {
        const x = parseMoney(a[sort.key]);
        const y = parseMoney(b[sort.key]);
        if (x === null || y === null) return (x === null ? 1 : 0) - (y === null ? 1 : 0);
        return dir * (x - y);
      }
      const x = cellValue(a, sort.key);
      const y = cellValue(b, sort.key);
      if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1);
      return dir * x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
    });
  }
  return [...base.filter((v) => v.starred), ...base.filter((v) => !v.starred)];
}

/* ── Values typed or pasted ── */

const STATUS_ALIASES = {
  research: 'Researching', researching: 'Researching', idea: 'Researching', maybe: 'Researching',
  inquired: 'Inquired', inquiry: 'Inquired', emailed: 'Inquired', contacted: 'Inquired', reached: 'Inquired',
  replied: 'Replied', responded: 'Replied', heard: 'Replied',
  'tour scheduled': 'Tour scheduled', tour: 'Tour scheduled', scheduled: 'Tour scheduled', visit: 'Tour scheduled',
  toured: 'Toured', visited: 'Toured', seen: 'Toured',
  quote: 'Quote received', quoted: 'Quote received', 'quote received': 'Quote received', proposal: 'Quote received',
  booked: 'Booked', signed: 'Booked', contract: 'Booked', deposit: 'Booked',
  'not a fit': 'Not a fit', no: 'Not a fit', pass: 'Not a fit', passed: 'Not a fit', declined: 'Not a fit', unavailable: 'Not a fit', 'not available': 'Not a fit',
};
export function matchStatus(value) {
  const s = str(value).toLowerCase().replace(/[.!]+$/, '');
  if (!s) return '';
  const exact = VENUE_STATUSES.find((x) => x.toLowerCase() === s);
  if (exact) return exact;
  if (STATUS_ALIASES[s]) return STATUS_ALIASES[s];
  const word = Object.keys(STATUS_ALIASES).find((k) => s.startsWith(`${k} `));
  return word ? STATUS_ALIASES[word] : '';
}

const pad = (n) => String(n).padStart(2, '0');
// "2026-03-14", "3/14/2026", "3/14/26", "Mar 14, 2026" → "2026-03-14"; else ''.
export function parseVenueDate(value) {
  const s = str(value);
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const mo = Number(m[1]);
    const d = Number(m[2]);
    return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(mo)}-${pad(d)}` : '';
  }
  if (!/[a-z]/i.test(s) || !/\d{4}/.test(s)) return '';
  const t = new Date(s);
  return isNaN(t) ? '' : `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/* ── Pasting from a spreadsheet ── */

// Header words → the field they mean. First match wins, so the specific ones
// ("contact email") come before the general ones ("contact").
const HEADER_RULES = [
  ['email', /e-?mail/],
  ['phone', /phone|cell|mobile|tel\b|number/],
  ['website', /web|site|url|link/],
  ['availability', /availab|open dates|dates? open/],
  ['lastContactDate', /last.*(contact|touch|email|spoke)|contacted|date/],
  ['allInclusive', /inclusive|incl\b|catered|in-?house/],
  ['perPersonHigh', /(per ?(plate|person|head|guest)|\bpp\b|plate).*\b(high|max|top|upper)\b|\b(high|max|top|upper)\b.*(per ?(plate|person|head|guest)|\bpp\b|plate)/],
  ['perPersonLow', /per ?(plate|person|head|guest|pp)|\/ ?(pp|person|plate|head)|\bpp\b|plate/],
  ['venueFeeHigh', /(venue|site|rental|room|space|admin).*\b(high|max|top|upper)\b|\b(high|max|top|upper)\b.*(venue|site|rental|fee)/],
  ['venueFeeLow', /venue (price|fee|cost|rental)|site fee|rental|room fee|space fee|admin/],
  ['nextStep', /next|to ?do|action|follow/],
  ['contactName', /contact|coordinator|planner|manager|rep\b|person|who/],
  ['status', /status|stage|state/],
  ['location', /location|address|city|town|where|area|region/],
  ['price', /pric|cost|\$|fee|quote|budget|rate|minimum/],
  ['capacity', /capacity|guests|seats|size|max|count|headcount/],
  ['notes', /note|comment|thought|detail|pros|cons|remark/],
  ['name', /venue|name|place|vendor/],
];

// What each pasted column goes into: a field key, a custom column's key,
// 'new' (a new column named after the header) or '' (skip it).
export function autoMapVenueHeaders(headerRow, customColumns = []) {
  const used = new Set();
  return (headerRow || []).map((h) => {
    const t = str(h).toLowerCase();
    if (!t) return '';
    const own = customColumns.find((c) => c.label.toLowerCase() === t);
    let key = own?.key || BUILTIN_COLUMNS.find((c) => !c.readOnly && c.label.toLowerCase() === t)?.key;
    if (!key) key = HEADER_RULES.find(([k, re]) => !used.has(k) && re.test(t))?.[0];
    if (!key || used.has(key)) return /[a-z]/.test(t) ? 'new' : '';
    used.add(key);
    return key;
  });
}

// Is the first pasted row headings rather than a venue? Yes when it names at
// least one field we know and none of its cells look like data.
export function looksLikeVenueHeader(rows) {
  const first = rows?.[0] || [];
  if (!first.some((h) => /[a-z]/i.test(h || ''))) return false;
  if (first.some((h) => /@|\d{3}.*\d{4}|^https?:/i.test(h || ''))) return false;
  return autoMapVenueHeaders(first).some((k) => k && k !== 'new');
}

// With no header row, guess from the values themselves: the first text column
// is the venue, an @ is an email, digits are a phone, and so on.
export function guessVenueColumns(rows) {
  const width = Math.max(0, ...(rows || []).map((r) => r.length));
  const used = new Set();
  const out = [];
  for (let i = 0; i < width; i++) {
    const vals = rows.map((r) => str(r[i])).filter(Boolean);
    const all = (re) => vals.length > 0 && vals.every((v) => re.test(v));
    let key = '';
    if (all(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) key = 'email';
    else if (all(/^[+()\d\s.-]{7,}$/)) key = 'phone';
    else if (all(/^(https?:\/\/|www\.)|\.(com|net|org|co|us)(\/|$)/i)) key = 'website';
    else if (vals.length && vals.every((v) => matchStatus(v))) key = 'status';
    else if (vals.length && vals.every((v) => parseVenueDate(v))) key = 'lastContactDate';
    else if (vals.length && !used.has('name')) key = 'name';
    else if (vals.length) key = 'new';
    if (key && key !== 'new' && used.has(key)) key = 'new';
    if (key && key !== 'new') used.add(key);
    out.push(key);
  }
  return out;
}

/* What a paste does to the list. `mapping[i]` is the field or custom-column
   key pasted column i goes into ('' to skip; resolve 'new' first). A row
   whose venue is already on the list updates it: each pasted cell that has
   something in it replaces that cell, and blank cells leave it alone. Rows
   with no venue name are skipped, and rows naming the same venue twice are
   folded into one. Returns { list, added, updated, skipped }. */
export function planVenuePaste(existing, rows, mapping, { makeId } = {}) {
  const list = (Array.isArray(existing) ? existing : []).map((v) => normalizeVenue(v));
  const added = [];
  const updated = [];
  let skipped = 0;
  for (const row of rows || []) {
    let draft = normalizeVenue({}, { id: 'paste' });
    let any = false;
    (mapping || []).forEach((key, i) => {
      const val = str(row?.[i]);
      if (!key || key === 'new' || !val) return;
      draft = withCellValue(draft, key, val);
      any = true;
    });
    if (!any) continue;
    if (!draft.name) { skipped += 1; continue; }
    const at = list.findIndex((v) => sameVenue(v, draft));
    if (at < 0) {
      list.push(normalizeVenue({ ...draft, id: makeId ? makeId() : undefined, source: 'manual' }));
      added.push(draft.name);
      continue;
    }
    let next = list[at];
    (mapping || []).forEach((key, i) => {
      const val = str(row?.[i]);
      if (!key || key === 'new' || !val || key === 'name') return;
      next = withCellValue(next, key, val);
    });
    if (JSON.stringify(next) !== JSON.stringify(list[at])) {
      list[at] = next;
      if (!added.includes(next.name) && !updated.includes(next.name)) updated.push(next.name);
    }
  }
  return { list, added, updated, skipped };
}
