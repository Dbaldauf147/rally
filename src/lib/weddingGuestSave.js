/* Saving the guest list without being able to wipe it.

   The list is one array on the user document, and a save used to replace the
   whole array with whatever the page had in memory. If the page's copy was
   wrong — it hadn't loaded, the load had failed, or the tab had been open
   since yesterday while the list was edited on a phone — the save replaced
   the real list with that copy.

   So a save is now a set of changes, not a list: what this page did between
   the list it was looking at (`base`) and the list it wants (`next`), applied
   to the list that is actually stored (`current`). A page that knows about no
   guests can add one; it cannot remove the ones it never saw.

   Guests are matched by id. A change is applied field by field, so two people
   editing different columns of the same guest both keep their edit. */

const idOf = (g) => (g && typeof g === 'object' ? g.id : undefined);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const asList = (v) => (Array.isArray(v) ? v : []);
// By id. A row with no id can't be matched, so it is never edited or removed
// by a merge — it stays wherever it is stored.
const byId = (list) => new Map(asList(list).filter((g) => idOf(g) != null).map((g) => [g.id, g]));

/* The fields `to` changed relative to `from`: { set: {k: v}, unset: [k] }. */
function fieldChanges(from, to) {
  const set = {};
  const unset = [];
  for (const k of Object.keys(to)) if (!same(from[k], to[k])) set[k] = to[k];
  for (const k of Object.keys(from)) if (!(k in to)) unset.push(k);
  return { set, unset };
}

/* What turning `base` into `next` did: guests added, removed and edited. */
export function guestListChanges(base, next) {
  const before = byId(base);
  const after = byId(next);
  const added = [];
  const edited = new Map();
  for (const [id, g] of after) {
    const was = before.get(id);
    if (!was) { added.push(g); continue; }
    const ch = fieldChanges(was, g);
    if (Object.keys(ch.set).length || ch.unset.length) edited.set(id, ch);
  }
  const removed = [...before.keys()].filter((id) => !after.has(id));
  return { added, removed, edited };
}

/* `next`, as it should be stored given that `current` is what's there now.

   When nothing else touched the list since this page read it (the usual
   case) that is `next` itself, order and all. Otherwise the page's changes
   are replayed on `current`: its edits land on the stored guests, its new
   guests go on the end, and only the guests it removed itself are dropped.

   Returns { list, removed } — `removed` being the ids this save takes off
   the stored list, for the caller to check against what it meant to do. */
export function mergeGuestList(base, next, current) {
  const stored = asList(current);
  const wanted = asList(next);
  const { added, removed, edited } = guestListChanges(base, wanted);
  const storedIds = new Set(byId(stored).keys());
  const dropping = removed.filter((id) => storedIds.has(id));
  if (same(asList(base), stored)) return { list: wanted, removed: dropping };

  const gone = new Set(removed);
  const list = stored.filter((g) => !gone.has(idOf(g))).map((g) => {
    const ch = edited.get(idOf(g));
    if (!ch) return g;
    const out = { ...g, ...ch.set };
    for (const k of ch.unset) delete out[k];
    return out;
  });
  const have = new Set(list.map(idOf));
  for (const g of added) if (!have.has(g.id)) list.push(g);
  return { list, removed: dropping };
}

export class GuestListGuardError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'GuestListGuardError';
    Object.assign(this, detail);
  }
}

/* Stops a save that would take guests off the list when the caller didn't say
   it was deleting anyone. Deleting and merging pass the ids they mean to
   remove; an edit, an import or a sync passes none, and so can never shrink
   the list — whatever went wrong upstream of it. */
export function checkRemovals(removed, allowed = []) {
  const ok = new Set(allowed);
  const unexpected = removed.filter((id) => !ok.has(id));
  if (unexpected.length) {
    throw new GuestListGuardError(
      `That save would have removed ${unexpected.length} guest${unexpected.length === 1 ? '' : 's'} from the list, so it was stopped. Nothing was changed.`,
      { unexpected },
    );
  }
}

/* ── One document per guest ──────────────────────────────────────────────

   Once an account's list has moved to users/{uid}/weddingGuests/{id}
   (lib/weddingGuestStore.js), a save writes only the guests it changed. The
   array on the user document stays as a copy for the things that read the
   whole list at once (the weekly email, the budget headcount), written in the
   same step — but it is no longer where the guests live, so nothing done to
   it can lose one. */

// The ids a save touches: the documents it has to read first.
export function touchedIds(base, next) {
  const { added, removed, edited } = guestListChanges(base, next);
  return [...added.map(idOf), ...removed, ...edited.keys()];
}

/* The document writes that turn `base` into `next`, given the guests as
   stored now (`currentById`: Map of id → document, for the touched ids).

   An edit is applied to the stored guest field by field. A guest edited here
   but deleted elsewhere stays deleted; one removed here that is already gone
   needs nothing. Returns { sets: [guest], deletes: [id] }. */
export function planGuestDocWrites(base, next, currentById) {
  const { added, removed, edited } = guestListChanges(base, next);
  const sets = [];
  for (const g of added) {
    if (idOf(g) == null) throw new Error('A guest needs an id to be saved');
    sets.push(g);
  }
  for (const [id, ch] of edited) {
    const cur = currentById.get(id);
    if (!cur) continue;
    const out = { ...cur, ...ch.set, id };
    for (const k of ch.unset) delete out[k];
    sets.push(out);
  }
  return { sets, deletes: removed.filter((id) => currentById.has(id)) };
}

/* A big save, as a run of lists each at most `size` guests different from the
   one before, ending at `next` — so no single step is too large to commit.
   The usual save is one step: [next]. */
export function saveSteps(base, next, size = 200) {
  const ids = touchedIds(base, next);
  if (ids.length <= size) return [asList(next)];
  const before = byId(base);
  const after = byId(next);
  const order = [...asList(next).map(idOf), ...asList(base).map(idOf).filter((id) => !after.has(id))];
  const steps = [];
  const done = new Set();
  for (let i = 0; i < ids.length; i += size) {
    for (const id of ids.slice(i, i + size)) done.add(id);
    if (i + size >= ids.length) { steps.push(asList(next)); break; }
    steps.push(order.map((id) => (done.has(id) ? after.get(id) : before.get(id))).filter(Boolean));
  }
  return steps;
}

// A guest's id has to work as a document name.
export const validGuestId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 500
  && !id.includes('/') && id !== '.' && id !== '..' && !/^__.*__$/.test(id);

/* Why a list can't move to one document per guest, or '' if it can. */
export function migrationBlocker(list) {
  const seen = new Set();
  for (const g of asList(list)) {
    if (!validGuestId(idOf(g))) return `a guest (${[g?.firstName, g?.lastName].filter(Boolean).join(' ') || 'unnamed'}) has no usable id`;
    if (seen.has(g.id)) return `two guests share the id ${g.id}`;
    seen.add(g.id);
  }
  return '';
}

const sortKeys = (v) => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
};
/* Whether two lists hold the same guests with the same details, whatever
   order the guests or their fields come in. */
export function sameGuests(a, b) {
  const norm = (l) => JSON.stringify([...byId(l).entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, g]) => sortKeys(g)));
  return asList(a).length === asList(b).length && norm(a) === norm(b);
}

/* Guest documents in the order the copy on the user document has them; any
   it doesn't know go on the end. */
export function inListOrder(docs, orderList) {
  const pos = new Map(asList(orderList).map((g, i) => [idOf(g), i]));
  return [...asList(docs)].sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity));
}

// Where each list's guests live once it has moved, and the field on the user
// document that says it has.
export const GUEST_COLLECTIONS = { weddingContacts: 'weddingGuests', weddingContactsV2: 'weddingGuestsV2' };
export const STORE_FLAG = 'weddingGuestStore';
export const usesGuestDocs = (userData) => userData?.[STORE_FLAG] === 'docs';
