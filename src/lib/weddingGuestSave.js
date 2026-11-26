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
