/* Comes With (`linkedTo` on a Friends contact) is a pair: if Ann comes with
   Ben, Ben comes with Ann. Only one side is ever edited at a time, so these
   work out what the other contacts need to stay in step. */

const byIdOf = (friends) => new Map((friends || []).filter(Boolean).map((f) => [f.id, f]));

/* Ann's Comes With was changed to `next` ('' = nobody). Returns the writes to
   the other contacts, as [{ id, linkedTo }]:
   - Ben (the new partner) comes with Ann;
   - anyone else who came with Ann or with Ben doesn't any more — Ben's old
     partner included, so nobody is left pointing at half of another pair. */
export function planComesWithSync(friends, id, next) {
  if (!id) return [];
  const byId = byIdOf(friends);
  const partner = next && next !== id ? byId.get(next) : null;
  const out = new Map();
  for (const f of byId.values()) {
    if (f.id === id || f.id === partner?.id) continue;
    if (f.linkedTo === id || (partner && f.linkedTo === partner.id)) out.set(f.id, '');
  }
  if (partner && partner.linkedTo !== id) out.set(partner.id, id);
  return [...out].map(([fid, linkedTo]) => ({ id: fid, linkedTo }));
}

/* Links saved before this was mutual: Ann → Ben where Ben comes with nobody.
   Ben gets Ann back — but only when Ann is the one person pointing at Ben,
   so an ambiguous case is left for a person to sort out. */
export function planComesWithBackfill(friends) {
  const byId = byIdOf(friends);
  const pointers = new Map();
  for (const f of byId.values()) {
    const to = f.linkedTo;
    if (!to || to === f.id || !byId.has(to)) continue;
    pointers.set(to, [...(pointers.get(to) || []), f.id]);
  }
  const out = [];
  for (const [to, from] of pointers) {
    if (from.length !== 1) continue;
    if (byId.get(to).linkedTo) continue;
    out.push({ id: to, linkedTo: from[0] });
  }
  return out;
}
