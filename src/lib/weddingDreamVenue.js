/* Wedding → Venues → Dream venue: what the venue has to be, as a checklist
   of categories and items you tick off, reword, add to and remove.

   Kept on the user doc as `weddingDreamVenue: { categories: [...] }`. Until
   it's first edited there is nothing stored and the list below is shown, so
   an untouched account always sees the current starting list.

   Ids are explicit, not positions, so rewording or reordering never moves a
   tick onto the wrong item. Pure, for testing without React.

   Categories read top to bottom, one per row, unless a category is marked
   `beside`: then it sits to the right of the one before it, in the same row
   (up to MAX_PER_ROW across). */

export const MAX_PER_ROW = 3;

const C = (id, title, items, beside = false) => ({ id, title, beside, items: items.map(([iid, t, detail = '']) => ({ id: iid, title: t, detail, done: false })) });

// Three lists side by side: what the venue has to have, what we'd like, and
// what we haven't decided yet.
export const SEED_CATEGORIES = [
  C('must-have', 'Must have', [
    ['water', 'By the water'],
  ]),
  C('preference', 'Preference', [
    ['not-winter', 'Not winter'],
    ['boats', 'With boats'],
  ], true),
  C('unsure', 'Unsure', [
    ['day-of-week', 'Day of the week?'],
    ['local-or-destination', 'Local or destination'],
  ], true),
];

const str = (v) => (typeof v === 'string' ? v : '');

export function newDreamId(prefix = 'd') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/* The stored list, cleaned: missing ids filled, duplicate ids renamed, odd
   values dropped. Nothing stored → the starting list. An empty stored list
   stays empty (you deleted everything; that's yours to keep). */
export function normalizeDreamVenue(raw) {
  const cats = Array.isArray(raw?.categories) ? raw.categories : null;
  if (!cats) return SEED_CATEGORIES.map((c) => ({ ...c, items: c.items.map((i) => ({ ...i })) }));
  const seen = new Set();
  const uniq = (id, prefix) => {
    let out = str(id).trim() || newDreamId(prefix);
    while (seen.has(out)) out = newDreamId(prefix);
    seen.add(out);
    return out;
  };
  return tidyRows(cats.filter((c) => c && typeof c === 'object').map((c) => ({
    id: uniq(c.id, 'cat'),
    title: str(c.title),
    beside: c.beside === true,
    items: (Array.isArray(c.items) ? c.items : []).filter((i) => i && typeof i === 'object').map((i) => ({
      id: uniq(i.id, 'item'),
      title: str(i.title),
      detail: str(i.detail),
      done: i.done === true,
    })),
  })));
}

// The first category has nothing to sit beside, and a row only holds so many.
function tidyRows(cats) {
  let inRow = 0;
  return cats.map((c, i) => {
    const beside = c.beside === true && i > 0 && inRow < MAX_PER_ROW;
    inRow = beside ? inRow + 1 : 1;
    return beside === c.beside ? c : { ...c, beside };
  });
}

// The categories as rows, each row the categories that sit side by side.
export function categoryRows(cats) {
  const rows = [];
  for (const c of cats || []) {
    if (c.beside && rows.length) rows[rows.length - 1].push(c);
    else rows.push([c]);
  }
  return rows;
}
const rowOf = (cats, catId) => categoryRows(cats).find((r) => r.some((c) => c.id === catId)) || [];
// Whether another list fits to the right of this category's row.
export const canAddBeside = (cats, catId) => { const n = rowOf(cats, catId).length; return n > 0 && n < MAX_PER_ROW; };
// Whether this category could move up beside the one before it.
export function canSitBeside(cats, catId) {
  const at = cats.findIndex((c) => c.id === catId);
  if (at <= 0 || cats[at].beside) return false;
  return rowOf(cats, cats[at - 1].id).length + rowOf(cats, catId).length <= MAX_PER_ROW;
}

const mapCat = (cats, catId, fn) => cats.map((c) => (c.id === catId ? fn(c) : c));
const mapItem = (cats, catId, itemId, fn) => mapCat(cats, catId, (c) => ({ ...c, items: c.items.map((i) => (i.id === itemId ? fn(i) : i)) }));
const move = (list, id, dir) => {
  const at = list.findIndex((x) => x.id === id);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
};

export const toggleItem = (cats, catId, itemId) => mapItem(cats, catId, itemId, (i) => ({ ...i, done: !i.done }));
export const editItem = (cats, catId, itemId, patch) => mapItem(cats, catId, itemId, (i) => ({ ...i, ...patch }));
export const removeItem = (cats, catId, itemId) => mapCat(cats, catId, (c) => ({ ...c, items: c.items.filter((i) => i.id !== itemId) }));
export const moveItem = (cats, catId, itemId, dir) => mapCat(cats, catId, (c) => ({ ...c, items: move(c.items, itemId, dir) }));
export function addItem(cats, catId, { title = '', detail = '' } = {}, id = newDreamId('item')) {
  return { cats: mapCat(cats, catId, (c) => ({ ...c, items: [...c.items, { id, title, detail, done: false }] })), id };
}

export const renameCategory = (cats, catId, title) => mapCat(cats, catId, (c) => ({ ...c, title }));
// Removing the first of a row leaves the next one to lead it.
export function removeCategory(cats, catId) {
  const at = cats.findIndex((c) => c.id === catId);
  if (at < 0) return cats;
  const next = cats.filter((c) => c.id !== catId);
  if (!cats[at].beside && next[at]?.beside) next[at] = { ...next[at], beside: false };
  return tidyRows(next);
}
// Two categories trade places; the layout (which spots share a row) stays.
export function moveCategory(cats, catId, dir) {
  const at = cats.findIndex((c) => c.id === catId);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= cats.length) return cats;
  const next = [...cats];
  next[at] = { ...cats[to], beside: cats[at].beside };
  next[to] = { ...cats[at], beside: cats[to].beside };
  return next;
}
export function addCategory(cats, title = '', id = newDreamId('cat')) {
  return { cats: [...cats, { id, title, beside: false, items: [] }], id };
}
// A new, empty list to the right of a category: at the end of its row.
export function addCategoryBeside(cats, catId, title = '', id = newDreamId('cat')) {
  if (!canAddBeside(cats, catId)) return { cats, id: null };
  const row = rowOf(cats, catId);
  const at = cats.findIndex((c) => c.id === row[row.length - 1].id);
  return { cats: [...cats.slice(0, at + 1), { id, title, beside: true, items: [] }, ...cats.slice(at + 1)], id };
}
// Put a category beside the one before it, or back on a row of its own
// (taking the ones to its right with it).
export function setBeside(cats, catId, beside) {
  if (beside && !canSitBeside(cats, catId)) return cats;
  return tidyRows(mapCat(cats, catId, (c) => ({ ...c, beside })));
}
// Every item in a category ticked, or every one unticked if they all were.
export const toggleCategory = (cats, catId) => mapCat(cats, catId, (c) => {
  const all = c.items.length > 0 && c.items.every((i) => i.done);
  return { ...c, items: c.items.map((i) => ({ ...i, done: !all })) };
});

export function dreamProgress(cats) {
  let done = 0;
  let total = 0;
  for (const c of cats || []) for (const i of c.items) { total += 1; if (i.done) done += 1; }
  return { done, total };
}
