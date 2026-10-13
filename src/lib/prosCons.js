// The Pros & Cons page: decisions, each with a list of pros and cons rated by
// how much they'd move things.
//
// One scale for both sides, written the way you'd say it — "will make this a
// little worse", "will ruin this" — rather than as numbers, because the point
// of rating a con is deciding whether it's an annoyance or a dealbreaker, and
// a 2 out of 3 doesn't say which. The numbers underneath are what the tally
// adds up.
//
// Pros only ever rate on the good half and cons on the bad half: a "pro" that
// makes things worse is a con, and letting it sit in the wrong column would
// make the tally lie about which side is heavier.

export const PRO = 'pro';
export const CON = 'con';

// Strongest first, the order the buttons run in.
export const SCALE = {
  [PRO]: [
    { value: 3, short: 'Much better', label: 'Will make this so much better' },
    { value: 2, short: 'Better', label: 'Will make this better' },
    { value: 1, short: 'A little better', label: 'Will make this a little better' },
  ],
  [CON]: [
    { value: -3, short: 'Ruins it', label: 'Will ruin this' },
    { value: -2, short: 'Worse', label: 'Will make this worse' },
    { value: -1, short: 'A little worse', label: 'Will make this a little worse' },
  ],
};

export const DEALBREAKER = -3;

export function ratingLabel(rating) {
  for (const side of [PRO, CON]) {
    const step = SCALE[side].find((s) => s.value === rating);
    if (step) return step.label;
  }
  return 'Not rated yet';
}

let seq = 0;
export function makeId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* fall through */ }
  seq += 1;
  return `${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

const text = (v) => String(v ?? '').trim();

// A rating has to belong to the item's own side, or it's no rating at all.
function cleanRating(side, rating) {
  const n = Number(rating);
  return SCALE[side].some((s) => s.value === n) ? n : null;
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const side = raw.side === CON ? CON : raw.side === PRO ? PRO : null;
  if (!side) return null;
  return {
    id: text(raw.id) || makeId(),
    side,
    text: text(raw.text),
    rating: cleanRating(side, raw.rating),
  };
}

function normalizeDecision(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: text(raw.id) || makeId(),
    title: text(raw.title),
    notes: text(raw.notes),
    createdAt: Number(raw.createdAt) || 0,
    items: (Array.isArray(raw.items) ? raw.items : []).map(normalizeItem).filter(Boolean),
  };
}

/* The stored shape, whatever came back from Firestore or the local cache.
   Newest decision first, since the one you just started is the one you're
   working on. */
export function normalizeProsCons(raw) {
  const decisions = (Array.isArray(raw?.decisions) ? raw.decisions : [])
    .map(normalizeDecision)
    .filter(Boolean);
  return { decisions };
}

const mapDecision = (data, id, fn) => ({
  ...data,
  decisions: data.decisions.map((d) => (d.id === id ? fn(d) : d)),
});

export function addDecision(data, { id = makeId(), title = '', now = Date.now() } = {}) {
  const decision = { id, title: text(title), notes: '', createdAt: now, items: [] };
  return { ...data, decisions: [decision, ...data.decisions] };
}

export function updateDecision(data, id, patch) {
  return mapDecision(data, id, (d) => ({
    ...d,
    ...('title' in patch ? { title: text(patch.title) } : {}),
    ...('notes' in patch ? { notes: text(patch.notes) } : {}),
  }));
}

export function removeDecision(data, id) {
  return { ...data, decisions: data.decisions.filter((d) => d.id !== id) };
}

export function addItem(data, decisionId, { id = makeId(), side, text: t = '', rating = null }) {
  const item = normalizeItem({ id, side, text: t, rating });
  if (!item) return data;
  return mapDecision(data, decisionId, (d) => ({ ...d, items: [...d.items, item] }));
}

export function updateItem(data, decisionId, itemId, patch) {
  return mapDecision(data, decisionId, (d) => ({
    ...d,
    items: d.items.map((it) => {
      if (it.id !== itemId) return it;
      const next = { ...it };
      if ('text' in patch) next.text = text(patch.text);
      if ('rating' in patch) next.rating = cleanRating(it.side, patch.rating);
      return next;
    }),
  }));
}

export function removeItem(data, decisionId, itemId) {
  return mapDecision(data, decisionId, (d) => ({ ...d, items: d.items.filter((it) => it.id !== itemId) }));
}

/* Where a decision stands.

   The two sides are weighed separately so the page can show how heavy each
   is, not just the difference — five little pros against one big con nets to
   +2, and that reads very differently from +2 with nothing on the other side.
   An unrated item is listed but weighs nothing until you say how much it
   matters. A "will ruin this" con is called out on its own: by definition no
   number of pros outweighs it, so it shouldn't be hidden inside a sum. */
export function tally(decision) {
  const items = decision?.items || [];
  let pro = 0;
  let con = 0;
  let unrated = 0;
  let dealbreakers = 0;
  for (const it of items) {
    if (it.rating == null) { unrated += 1; continue; }
    if (it.rating > 0) pro += it.rating;
    else con += -it.rating;
    if (it.rating === DEALBREAKER) dealbreakers += 1;
  }
  const net = pro - con;
  let verdict;
  if (pro === 0 && con === 0) verdict = items.length ? 'Rate them to see where it leans' : 'Nothing listed yet';
  else if (dealbreakers > 0) verdict = dealbreakers === 1 ? 'There’s a dealbreaker' : `${dealbreakers} dealbreakers`;
  else if (net > 0) verdict = net >= Math.max(3, con) ? 'Leaning yes' : 'Slightly yes';
  else if (net < 0) verdict = -net >= Math.max(3, pro) ? 'Leaning no' : 'Slightly no';
  else verdict = 'A toss-up';
  return {
    pro,
    con,
    net,
    unrated,
    dealbreakers,
    verdict,
    pros: items.filter((it) => it.side === PRO).length,
    cons: items.filter((it) => it.side === CON).length,
  };
}
