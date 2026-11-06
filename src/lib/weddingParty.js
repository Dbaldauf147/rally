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
