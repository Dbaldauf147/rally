// The Joanne list: the things you mean to do with her.
//
// One list, not a page per kind. "Watch Past Lives", "eat at Lilia", "give her
// the Rothko book" are the same thought — something to do together, written
// down before it's forgotten — and they belong in one place you can scan. The
// kind is a label on the entry, so the page can filter to Movies when you're
// picking a film and show everything when you're not.
//
// Kinds are the owner's own, like the Doctors page's types: the six below are
// a starting point, and any kind an entry uses is registered whether or not
// the list declares it, so a kind can never strand its entries.

export const WANT = 'want';
export const DONE = 'done';

export const DEFAULT_KINDS = ['Movie', 'Show', 'Eat', 'Do', 'Gift', 'Trip'];

/* What each kind is called in the doing. A watchlist that says "want to go"
   about a film reads like a form; this is the difference between a list that
   sounds like you and one that sounds like software. Unknown kinds fall back
   to the plain verb. */
const VERBS = {
  movie: ['want to watch', 'watched'],
  show: ['want to watch', 'watched'],
  eat: ['want to go', 'went'],
  do: ['want to do', 'did'],
  gift: ['want to give', 'gave'],
  trip: ['want to go', 'went'],
};

export function statusLabel(kind, status) {
  const pair = VERBS[String(kind || '').trim().toLowerCase()] || ['want to', 'done'];
  return status === DONE ? pair[1] : pair[0];
}

export const sameKind = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

let seq = 0;
export function makeId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  seq += 1;
  return `j${Date.now().toString(36)}${seq}`;
}

export const todayKey = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function normalizeItem(raw) {
  const rating = Math.round(Number(raw?.rating));
  return {
    id: String(raw?.id ?? '').trim() || makeId(),
    kind: String(raw?.kind ?? '').trim(),
    title: String(raw?.title ?? '').trim(),
    notes: String(raw?.notes ?? '').trim(),
    // Where to see it, book it, buy it — one link is enough for a list entry.
    link: String(raw?.link ?? '').trim(),
    status: raw?.status === DONE ? DONE : WANT,
    // The day you did it, or the day you mean to. Free of a time on purpose.
    date: String(raw?.date ?? '').trim(),
    rating: Number.isFinite(rating) ? Math.min(5, Math.max(0, rating)) : 0,
    created: String(raw?.created ?? '').trim() || todayKey(),
  };
}

function dedupeKinds(names) {
  const out = [];
  names.forEach((raw) => {
    const name = String(raw ?? '').trim();
    if (name && !out.some((k) => sameKind(k, name))) out.push(name);
  });
  return out;
}

export function normalizeList(raw) {
  const rawItems = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : [];
  const items = rawItems.map(normalizeItem).filter((i) => i.title || i.notes);
  const declared = Array.isArray(raw?.kinds) ? raw.kinds : DEFAULT_KINDS;
  // A kind an entry uses but the list has lost is added back, so deleting a
  // kind can never hide the entries filed under it.
  return { kinds: dedupeKinds([...declared, ...items.map((i) => i.kind)]), items };
}

export function addItem(list, item = {}) {
  const l = normalizeList(list);
  return normalizeList({ ...l, items: [normalizeItem({ ...item, id: item.id || makeId() }), ...l.items] });
}

// The id is fixed: a patch carrying a stale one can't turn an edit into a
// second entry.
export function updateItem(list, id, patch) {
  const l = normalizeList(list);
  return normalizeList({
    ...l,
    items: l.items.map((i) => (i.id === id ? normalizeItem({ ...i, ...patch, id: i.id }) : i)),
  });
}

export function removeItem(list, id) {
  const l = normalizeList(list);
  return normalizeList({ ...l, items: l.items.filter((i) => i.id !== id) });
}

/* Ticking something off dates it today, so "when did we see that?" has an
   answer without typing one. Un-ticking clears the date again rather than
   leaving a day you didn't do it on. A date you typed yourself is kept. */
export function setStatus(list, id, status, today = todayKey()) {
  const l = normalizeList(list);
  const item = l.items.find((i) => i.id === id);
  if (!item) return l;
  const done = status === DONE;
  const date = done ? (item.date || today) : (item.status === DONE ? '' : item.date);
  return updateItem(l, id, { status: done ? DONE : WANT, date, rating: done ? item.rating : 0 });
}

export function addKind(list, name) {
  const l = normalizeList(list);
  const kind = String(name || '').trim();
  if (!kind || l.kinds.some((k) => sameKind(k, kind))) return l;
  return normalizeList({ ...l, kinds: [...l.kinds, kind] });
}

/* Deleting a kind keeps its entries — they lose the label, nothing else. */
export function removeKind(list, name) {
  const l = normalizeList(list);
  return normalizeList({
    ...l,
    kinds: l.kinds.filter((k) => !sameKind(k, name)),
    items: l.items.map((i) => (sameKind(i.kind, name) ? { ...i, kind: '' } : i)),
  });
}

export function kindUsage(items, name) {
  return items.filter((i) => sameKind(i.kind, name)).length;
}

export function counts(items) {
  const out = { all: items.length, [WANT]: 0, [DONE]: 0, byKind: {} };
  items.forEach((i) => {
    out[i.status] += 1;
    const key = i.kind || '';
    out.byKind[key] = (out.byKind[key] || 0) + 1;
  });
  return out;
}

export const matches = (item, query) => {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [item.title, item.notes, item.kind].some((v) => String(v || '').toLowerCase().includes(q));
};

/* What the page shows: the kind you picked, what you searched for, and
   whether you're looking at what's still to do.

   Still-to-do first and newest first within that, because the list is read to
   answer "what could we do?" far more often than "what did we do?" — and the
   things you have done are still there, under them, for the night you want to
   remember the name of that place. */
export function visibleItems(list, { kind = 'all', query = '', status = 'all' } = {}) {
  const l = normalizeList(list);
  return l.items
    .filter((i) => (kind === 'all' || sameKind(i.kind, kind)))
    .filter((i) => (status === 'all' || i.status === status))
    .filter((i) => matches(i, query))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === WANT ? -1 : 1;
      // Done things read best most-recent-first; wants, newest-written first.
      const aKey = a.status === DONE ? (a.date || a.created) : a.created;
      const bKey = b.status === DONE ? (b.date || b.created) : b.created;
      return bKey.localeCompare(aKey);
    });
}
