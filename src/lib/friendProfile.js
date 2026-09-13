// What a friend is into, and what you appreciate about them — kept on the
// friend doc as `profile`.
//
// Each section ("Likes", "Things I appreciate") is an outline: categories with
// the specifics under them, and sometimes a note under those — "Drinking" →
// "Coffee" → "Cold brew, get her a big jug for her bday". The outline is stored
// flat, one row per line with a depth, rather than as a tree. That's the shape
// the editor works in (a line is indented, outdented, inserted or removed), and
// it keeps every edit a matter of changing one array.
//
// Kept pure so the parsing and editing can be unit-tested; FriendsPage owns the
// reading and writing.

export const MAX_DEPTH = 3;

// What a friend with nothing recorded starts with. Offered in the editor, and
// only stored once something is written under one.
export const DEFAULT_SECTIONS = ['Likes', 'Things I appreciate'];

let seq = 0;
export function makeId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  seq += 1;
  return `p${Date.now().toString(36)}${seq}`;
}

const clampDepth = (d) => Math.max(0, Math.min(MAX_DEPTH, Math.floor(Number(d) || 0)));

/* The rows of one outline, with depths repaired.

   A row can sit at most one level under the row above it — a line indented
   three steps under a category has no parent at the two levels between — so
   anything deeper is pulled back up rather than rendered floating. */
export function normalizeItems(raw) {
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach((r) => {
    const text = String(r?.text ?? '');
    const prev = out[out.length - 1];
    const cap = prev ? prev.depth + 1 : 0;
    out.push({
      id: String(r?.id ?? '').trim() || makeId(),
      text,
      depth: Math.min(clampDepth(r?.depth), cap),
    });
  });
  return out;
}

export function normalizeProfile(raw) {
  return (Array.isArray(raw) ? raw : []).map((s) => ({
    id: String(s?.id ?? '').trim() || makeId(),
    title: String(s?.title ?? '').trim(),
    items: normalizeItems(s?.items),
  }));
}

/* What the editor opens with: the stored sections, or the two defaults for a
   friend who has none yet. */
export function profileForEditing(raw) {
  const sections = normalizeProfile(raw);
  if (sections.length) return sections;
  return DEFAULT_SECTIONS.map((title) => ({ id: makeId(), title, items: [] }));
}

/* What gets saved. Blank lines go, and so does a section with nothing written
   in it — an untouched "Things I appreciate" isn't worth a field on every doc.
   A section you've titled yourself stays even while empty, because naming it
   was the point. */
export function profileForSaving(sections) {
  return normalizeProfile(sections)
    .map((s) => ({ ...s, items: normalizeItems(s.items.filter((i) => i.text.trim()).map((i) => ({ ...i, text: i.text.trim() }))) }))
    .filter((s) => s.items.length > 0 || (s.title && !DEFAULT_SECTIONS.includes(s.title)));
}

export const hasProfile = (raw) => normalizeProfile(raw).some((s) => s.items.some((i) => i.text.trim()));

// --- editing one outline -----------------------------------------------------
//
// Each takes the rows and hands back new ones. Out-of-range indices are no-ops,
// so the row buttons can stay live without the caller checking first.

// The row and everything nested under it.
function subtreeEnd(items, index) {
  const depth = items[index].depth;
  let end = index + 1;
  while (end < items.length && items[end].depth > depth) end += 1;
  return end;
}

// A new row after `index`, at its depth unless one is given — or at the top
// when the outline is empty or `index` is -1.
export function insertItem(items, index, { text = '', depth: wanted } = {}) {
  const rows = normalizeItems(items);
  const at = Math.max(-1, Math.min(index, rows.length - 1));
  const depth = wanted ?? (at >= 0 ? rows[at].depth : 0);
  const item = { id: makeId(), text, depth };
  return { items: normalizeItems([...rows.slice(0, at + 1), item, ...rows.slice(at + 1)]), id: item.id };
}

export function setItemText(items, index, text) {
  const rows = normalizeItems(items);
  if (!rows[index]) return rows;
  return rows.map((r, i) => (i === index ? { ...r, text } : r));
}

/* Indent a row under the one above it. What's nested under it comes along, so
   indenting "Coffee" doesn't leave "Cold brew" behind under "Drinking". */
export function indentItem(items, index) {
  const rows = normalizeItems(items);
  if (index <= 0 || !rows[index]) return rows;
  if (rows[index].depth > rows[index - 1].depth) return rows; // already the first child
  const end = subtreeEnd(rows, index);
  if (rows.slice(index, end).some((r) => r.depth >= MAX_DEPTH)) return rows;
  return rows.map((r, i) => (i >= index && i < end ? { ...r, depth: r.depth + 1 } : r));
}

export function outdentItem(items, index) {
  const rows = normalizeItems(items);
  if (!rows[index] || rows[index].depth === 0) return rows;
  const end = subtreeEnd(rows, index);
  return normalizeItems(rows.map((r, i) => (i >= index && i < end ? { ...r, depth: r.depth - 1 } : r)));
}

/* Remove a row. What was under it moves up a level rather than going with it —
   deleting the word "Food" shouldn't quietly delete the omakase place. */
export function removeItem(items, index) {
  const rows = normalizeItems(items);
  if (!rows[index]) return rows;
  const end = subtreeEnd(rows, index);
  return normalizeItems([
    ...rows.slice(0, index),
    ...rows.slice(index + 1, end).map((r) => ({ ...r, depth: r.depth - 1 })),
    ...rows.slice(end),
  ]);
}

// Move a row, with what's under it, past its neighbouring sibling.
export function moveItem(items, index, delta) {
  const rows = normalizeItems(items);
  if (!rows[index]) return rows;
  const depth = rows[index].depth;
  const end = subtreeEnd(rows, index);
  const block = rows.slice(index, end);
  if (delta < 0) {
    let prev = index - 1;
    while (prev >= 0 && rows[prev].depth > depth) prev -= 1;
    if (prev < 0 || rows[prev].depth !== depth) return rows;
    return normalizeItems([...rows.slice(0, prev), ...block, ...rows.slice(prev, index), ...rows.slice(end)]);
  }
  if (end >= rows.length || rows[end].depth !== depth) return rows;
  const nextEnd = subtreeEnd(rows, end);
  return normalizeItems([...rows.slice(0, index), ...rows.slice(end, nextEnd), ...block, ...rows.slice(nextEnd)]);
}

// --- pasting a list in -------------------------------------------------------

const BULLET = /^(?:[-*•◦▪‣·]|\d+[.)])\s+/;

// Leading whitespace as a width: a tab is a step of its own, like four spaces.
const indentWidth = (line) => {
  const lead = /^[\t ]*/.exec(line)[0];
  return [...lead].reduce((n, c) => n + (c === '\t' ? 4 : 1), 0);
};

/* A list typed or pasted from somewhere else — Notes, a doc, an email — as
   outline rows.

   Nesting comes from indentation, whatever unit it was done in: each deeper
   indent than the line above is one level in, and a shallower one goes back
   to whichever earlier level it lines up with. Bullets and numbers are
   stripped. A line starting "# " begins a new section, which is how one paste
   can fill "Likes" and "Things I appreciate" at once.

   Returns sections; the first has an empty title when the text doesn't open
   with a heading, meaning "whichever section it was pasted into". */
export function parseOutline(text) {
  const sections = [{ title: '', items: [] }];
  let widths = []; // indent width at each depth of the current run

  String(text ?? '').replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
    if (!line.trim()) return;
    const heading = /^\s*#+\s+(.*)$/.exec(line);
    if (heading) {
      sections.push({ title: heading[1].trim(), items: [] });
      widths = [];
      return;
    }
    const width = indentWidth(line);
    let depth;
    if (!widths.length) {
      depth = 0;
      widths = [width];
    } else if (width > widths[widths.length - 1]) {
      depth = widths.length;
      widths.push(width);
    } else {
      while (widths.length > 1 && width < widths[widths.length - 1]) widths.pop();
      depth = widths.length - 1;
    }
    const body = line.trim().replace(BULLET, '').trim();
    if (body) sections[sections.length - 1].items.push({ text: body, depth });
  });

  return sections
    .map((s) => ({ title: s.title, items: normalizeItems(s.items) }))
    .filter((s, i) => i > 0 || s.items.length > 0);
}

/* Paste into a profile. A heading that matches an existing section (ignoring
   case) adds to it; a new heading adds a section; untitled lines go into
   `intoSectionId`. Appended, never replacing what's there. */
export function mergeParsed(sections, parsed, intoSectionId) {
  let out = normalizeProfile(sections);
  parsed.forEach((p) => {
    const target = p.title
      ? out.find((s) => s.title.toLowerCase() === p.title.toLowerCase())
      : out.find((s) => s.id === intoSectionId) || out[0];
    if (target) {
      out = out.map((s) => (s.id === target.id
        ? { ...s, items: normalizeItems([...s.items.filter((i) => i.text.trim()), ...p.items]) }
        : s));
    } else {
      out = [...out, { id: makeId(), title: p.title || 'Likes', items: p.items }];
    }
  });
  return out;
}
