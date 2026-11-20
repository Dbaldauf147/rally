/* Budget → Venue cost comparison: the table's columns in the couple's order,
   its venues sorted by a column, and narrowed by a search. Pure, so the
   component only draws what these return. */

/* The column blocks in the saved order. `defaults` is every block's key in
   the table's own order; a key the saved order doesn't know (a category
   added since) keeps its place after the block it follows by default, and a
   saved key that's gone is ignored. */
export function orderBlocks(defaults, saved) {
  const known = new Set(defaults);
  const out = (saved || []).filter((k) => known.has(k));
  const placed = new Set(out);
  defaults.forEach((k, i) => {
    if (placed.has(k)) return;
    // After the nearest default predecessor already placed, else first.
    let at = 0;
    for (let j = i - 1; j >= 0; j -= 1) {
      const p = out.indexOf(defaults[j]);
      if (p >= 0) { at = p + 1; break; }
    }
    out.splice(at, 0, k);
    placed.add(k);
  });
  return out;
}

/* Move one block to where another is (drag `key` onto `target`), or by a
   step (-1 left, +1 right). Returns the new order; the same one when nothing moves. */
export function moveBlock(order, key, target) {
  const from = order.indexOf(key);
  if (from < 0) return order;
  const to = typeof target === 'number' ? from + target : order.indexOf(target);
  if (to < 0 || to >= order.length || to === from) return order;
  const out = [...order];
  out.splice(from, 1);
  out.splice(to, 0, key);
  return out;
}

/* Next sort on a header click: ascending, then descending, then off. */
export function nextSort(sort, key) {
  if (!sort || sort.key !== key) return { key, dir: 'asc' };
  return sort.dir === 'asc' ? { key, dir: 'desc' } : null;
}

/* Venue indexes in display order. `valueOf(i)` is the sort value of venue i
   (a number or a string); blanks (null, undefined, '') go last either way,
   and ties keep the saved order. */
export function sortedIndexes(n, sort, valueOf) {
  const idx = Array.from({ length: n }, (_, i) => i);
  if (!sort) return idx;
  const blank = (v) => v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v));
  const sign = sort.dir === 'desc' ? -1 : 1;
  const vals = idx.map((i) => valueOf(i));
  return idx.sort((a, b) => {
    const x = vals[a];
    const y = vals[b];
    if (blank(x) || blank(y)) return blank(x) === blank(y) ? a - b : blank(x) ? 1 : -1;
    const c = typeof x === 'string' || typeof y === 'string'
      ? String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true })
      : x - y;
    return c === 0 ? a - b : c * sign;
  });
}

/* True when every word of the search appears somewhere in the texts
   (a venue's name, its area, its availability notes), whatever the case. */
export function matchesSearch(query, texts) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}
