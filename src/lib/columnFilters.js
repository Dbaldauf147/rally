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
