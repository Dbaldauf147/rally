/* Wedding groups — households or parties ("Smith family", "College roommates")
   on the guest list, separate from the A/B/C tiers in `group`.

   A guest's group is `party` (free text, matched case-insensitively) and
   their place in it is `partyOrder` (a number, lowest first; guests without
   one follow, by name). Couples move as one: two guests are a couple when
   their Friends contacts point at each other through Comes With (`linkedTo`),
   or one points at the other and that other points nowhere else. A couple in
   the same group always sits side by side, so reordering moves "units" — a
   single guest or a couple — never half a pair. */

export const partyKey = (s) => String(s || '').trim().toLowerCase();

const orderOf = (g) => (typeof g?.partyOrder === 'number' && Number.isFinite(g.partyOrder) ? g.partyOrder : Infinity);
const nameOf = (g) => `${g?.firstName || ''} ${g?.lastName || ''}`.trim();
export const guestName = nameOf;

// guest id → the guest id of their partner, for every couple on the list.
export function partnerMap(guests, friendsById) {
  const list = Array.isArray(guests) ? guests : [];
  const guestByFriend = new Map();
  for (const g of list) if (g?.friendId && !guestByFriend.has(g.friendId)) guestByFriend.set(g.friendId, g);
  const linkOf = (friendId) => {
    const to = friendsById?.get?.(friendId)?.linkedTo;
    return to && to !== friendId ? to : '';
  };
  const out = new Map();
  for (const g of list) {
    if (!g?.friendId || out.has(g.id)) continue;
    const to = linkOf(g.friendId);
    const p = to && guestByFriend.get(to);
    if (!p || p.id === g.id || out.has(p.id)) continue;
    // The other half must point back, or point nowhere — never at a third person.
    const back = linkOf(p.friendId);
    if (back && back !== g.friendId) continue;
    out.set(g.id, p.id);
    out.set(p.id, g.id);
  }
  return out;
}

// The members of one group as ordered units: [[guest], [guest, partner], …].
export function partyUnits(members, partners) {
  const sorted = [...(members || [])].sort((a, b) => {
    const d = orderOf(a) - orderOf(b);
    if (d) return d;
    return nameOf(a).localeCompare(nameOf(b));
  });
  const byId = new Map(sorted.map((g) => [g.id, g]));
  const placed = new Set();
  const units = [];
  for (const g of sorted) {
    if (placed.has(g.id)) continue;
    placed.add(g.id);
    const unit = [g];
    const pid = partners?.get?.(g.id);
    if (pid && byId.has(pid) && !placed.has(pid)) {
      unit.push(byId.get(pid));
      placed.add(pid);
    }
    units.push(unit);
  }
  return units;
}

// Swap unit i with its neighbour (dir -1 up, +1 down). Out of range: unchanged.
export function moveUnit(units, i, dir) {
  const j = i + dir;
  if (i < 0 || j < 0 || i >= units.length || j >= units.length) return units;
  const next = [...units];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// guest id → partyOrder for a group laid out as `units`.
export function orderFromUnits(units) {
  const m = new Map();
  let n = 0;
  for (const u of units) for (const g of u) m.set(g.id, n++);
  return m;
}

// Every guest with a group → their position in it, for the table's sort.
export function partyPositions(guests, partners) {
  const groups = new Map();
  for (const g of guests || []) {
    const k = partyKey(g?.party);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(g);
  }
  const pos = new Map();
  for (const members of groups.values()) {
    for (const [id, n] of orderFromUnits(partyUnits(members, partners))) pos.set(id, n);
  }
  return pos;
}

/* The table outlines households and couples, which only reads when they sit
   together. Couples are pulled together whatever the sort: the second half
   follows the first wherever the first lands. With `sameGroupOnly` (the
   Wedding group sort) a partner in a different group stays in their own;
   `canPair(a, b)` narrows it further (a column sort only pairs partners that
   tie on that column, so the sort itself is never broken). */
export function keepCouplesTogether(rows, partners, { sameGroupOnly = false, canPair } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const byId = new Map(list.map((r) => [r.id, r]));
  const placed = new Set();
  const out = [];
  for (const r of list) {
    if (placed.has(r.id)) continue;
    placed.add(r.id);
    out.push(r);
    const p = byId.get(partners?.get?.(r.id));
    if (!p || placed.has(p.id)) continue;
    if (sameGroupOnly && partyKey(p.party) !== partyKey(r.party)) continue;
    if (canPair && !canPair(r, p)) continue;
    placed.add(p.id);
    out.push(p);
  }
  return out;
}

/* Where the outlines go, for rows in display order: id → { group, couple },
   each 'top' | 'mid' | 'bottom' | 'only' or absent. A group box is a run of
   two or more adjacent rows in the same wedding group; a couple box is two
   adjacent partners. */
export function rowOutlines(rows, partners) {
  const list = Array.isArray(rows) ? rows : [];
  const out = new Map(list.map((r) => [r.id, {}]));
  let i = 0;
  while (i < list.length) {
    const k = partyKey(list[i].party);
    let j = i + 1;
    if (k) while (j < list.length && partyKey(list[j].party) === k) j++;
    if (k && j - i >= 2) {
      for (let n = i; n < j; n++) out.get(list[n].id).group = n === i ? 'top' : n === j - 1 ? 'bottom' : 'mid';
    }
    i = j;
  }
  for (let n = 0; n + 1 < list.length; n++) {
    const a = list[n];
    const b = list[n + 1];
    if (partners?.get?.(a.id) === b.id && !out.get(a.id).couple) {
      out.get(a.id).couple = 'top';
      out.get(b.id).couple = 'bottom';
    }
  }
  return out;
}

/* The table's group view: every wedding group as one block, whatever the
   sort. A block sits where its first member falls in the sorted rows (so the
   column sort still decides which group comes first), and inside it guests
   keep the group's own order (partyUnits) with couples side by side. Guests
   with no group stay where the sort put them, a couple among them pulled
   together. Only rows passed in are placed — a filtered-out member stays out. */
export function groupPartiesTogether(rows, partners, { canPair } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const members = new Map();
  for (const r of list) {
    const k = partyKey(r.party);
    if (!k) continue;
    if (!members.has(k)) members.set(k, []);
    members.get(k).push(r);
  }
  const emitted = new Set();
  const out = [];
  for (const r of list) {
    const k = partyKey(r.party);
    if (!k) { out.push(r); continue; }
    if (emitted.has(k)) continue;
    emitted.add(k);
    for (const unit of partyUnits(members.get(k), partners)) out.push(...unit);
  }
  // Couples inside a block are already paired (partyUnits); canPair, when
  // given, limits which ungrouped couples get pulled together.
  return keepCouplesTogether(out, partners, { sameGroupOnly: true, canPair: canPair && ((x, y) => !!partyKey(x.party) || canPair(x, y)) });
}

/* A guest's Comes With partner goes where they go. Run over each write of the
   guest list (`prev` → `next`): for every guest whose wedding group changed,
   their partner — the Friends contact they point at, or the one pointing at
   them — is put in the same group. A partner already on the list moves only
   if they had no group or were in the guest's old group, so someone placed
   elsewhere on purpose stays put (the pop-up offers to bring them over). A
   partner not on the list yet is added to it, in that group.
   Returns the list to write, plus the names moved and added. */
export function partnersFollowGroup(prev, next, friendsById, { makeGuest } = {}) {
  const list = Array.isArray(next) ? next.map((g) => g) : [];
  const before = new Map((Array.isArray(prev) ? prev : []).map((g) => [g.id, g]));
  const friendOf = (id) => friendsById?.get?.(id);
  const partnerFriendId = (friendId) => {
    const own = friendOf(friendId)?.linkedTo;
    if (own && own !== friendId && friendOf(own)) return own;
    const backs = [...(friendsById?.values?.() || [])].filter((f) => f?.linkedTo === friendId && f.id !== friendId);
    return backs.length === 1 ? backs[0].id : '';
  };
  const indexByFriend = () => {
    const m = new Map();
    list.forEach((g, i) => { if (g?.friendId && !m.has(g.friendId)) m.set(g.friendId, i); });
    return m;
  };
  const changed = list.filter((g) => {
    if (!g?.friendId) return false;
    const was = before.get(g.id);
    return partyKey(was?.party) !== partyKey(g.party) && (was || partyKey(g.party));
  });
  const touched = new Set(changed.map((g) => g.id));
  const moved = [];
  const added = [];
  for (const g of changed) {
    const pid = partnerFriendId(g.friendId);
    if (!pid) continue;
    const at = indexByFriend().get(pid);
    if (at !== undefined) {
      const p = list[at];
      if (touched.has(p.id)) continue; // they were moved in this same write
      const from = partyKey(p.party);
      if (from === partyKey(g.party)) continue;
      if (from && from !== partyKey(before.get(g.id)?.party)) continue;
      list[at] = { ...p, party: g.party || '', partyOrder: null };
      touched.add(p.id);
      moved.push(guestName(p));
    } else if (partyKey(g.party) && makeGuest) {
      const guest = makeGuest(friendOf(pid));
      if (!guest) continue;
      const row = { ...guest, party: g.party, partyOrder: null };
      list.push(row);
      touched.add(row.id);
      added.push(guestName(row));
    }
  }
  return { list, moved, added };
}

/* The Wedding group cell's suggestions for what's typed: every group when
   nothing is, otherwise the ones containing it (those starting with it
   first). `exact` is the existing group the text names, case aside, so typing
   "smith family" files them under "Smith family" rather than a second group. */
export function partySuggestions(parties, query) {
  const q = partyKey(query);
  const all = Array.isArray(parties) ? parties.filter((p) => partyKey(p)) : [];
  const exact = q ? all.find((p) => partyKey(p) === q) || '' : '';
  if (!q) return { matches: all, exact, canCreate: false };
  const starts = all.filter((p) => partyKey(p).startsWith(q));
  const contains = all.filter((p) => !partyKey(p).startsWith(q) && partyKey(p).includes(q));
  return { matches: [...starts, ...contains], exact, canCreate: !exact };
}
