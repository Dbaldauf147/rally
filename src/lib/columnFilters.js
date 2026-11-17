// Filtering a table by typing under its column headers.
//
// Each column's box is matched against the text that column shows — so a
// birthday matches "7/30", not the stored "07-30" — and a row stays only if
// every box with something in it matches. Pure; the page supplies the text.

// Does `text` match what was typed? Every word typed has to appear, in any
// order and case ("smith jo" finds "Jo Smith"). With `digits`, digits are
// compared on their own, so "555123" finds "(555) 123-4567".
export function matchesColumnFilter(text, query, { digits = false } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  const t = String(text ?? '').toLowerCase();
  if (digits) {
    const qd = q.replace(/\D/g, '');
    if (qd && qd.length === q.replace(/[\s()+.-]/g, '').length) return t.replace(/\D/g, '').includes(qd);
  }
  return q.split(/\s+/).every((word) => t.includes(word));
}

// The column boxes that have something in them.
export const activeColumnFilters = (filters) =>
  Object.entries(filters || {}).filter(([, v]) => String(v ?? '').trim());

// The rows every filled-in box matches. `textOf(row, key)` is what that
// column shows for the row; `digitKeys` are the columns matched by digits.
export function applyColumnFilters(rows, filters, textOf, digitKeys = []) {
  const active = activeColumnFilters(filters);
  if (active.length === 0) return rows;
  const digitSet = new Set(digitKeys);
  return rows.filter((row) => active.every(([key, q]) => matchesColumnFilter(textOf(row, key), q, { digits: digitSet.has(key) })));
}

/* ── Picking values ──
   Beside typing, a column can be filtered by ticking the values it holds, as
   many as you like: "Toured" and "Quote received", say. `picks` is
   { [key]: [value…] }; a row stays if, for every column with something
   ticked, its value is one of them. '' stands for a blank cell. */

// The ticked lists that have something in them.
export const activePicks = (picks) =>
  Object.entries(picks || {}).filter(([, list]) => Array.isArray(list) && list.length > 0);

// The rows whose value is ticked in every column that has ticks.
// `valueOf(row, key)` is the value that column is picked by.
export function applyColumnPicks(rows, picks, valueOf) {
  const active = activePicks(picks).map(([key, list]) => [key, new Set(list)]);
  if (active.length === 0) return rows;
  return rows.filter((row) => active.every(([key, set]) => set.has(String(valueOf(row, key) ?? '').trim())));
}

// Each value a column holds across `rows`, with how many rows have it:
// [{ value, count }], blanks first, then in alphabetical (natural) order.
export function columnValues(rows, key, valueOf) {
  const counts = new Map();
  for (const row of rows || []) {
    const v = String(valueOf(row, key) ?? '').trim();
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts].map(([value, count]) => ({ value, count }))
    .sort((a, b) => (a.value === '' ? -1 : b.value === '' ? 1 : a.value.localeCompare(b.value, undefined, { numeric: true, sensitivity: 'base' })));
}

// Tick or untick one value.
export function togglePick(picks, key, value) {
  const list = Array.isArray(picks?.[key]) ? picks[key] : [];
  const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  const out = { ...(picks || {}) };
  if (next.length) out[key] = next; else delete out[key];
  return out;
}
