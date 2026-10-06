// Splitting a list of people into one table per Friends "Group". Shared by the
// Friends page and an event's People & Poll tab so both draw the same tables.

export const NO_GROUP = 'No group';

// A friend's `group` is a comma-separated list: "Family, College".
export function groupTokens(value) {
  return String(value || '').split(',').map(g => g.trim()).filter(Boolean);
}

// Turning one group on or off in that list, matched without regard to case
// ("family" ticks "Family"), keeping the rest in the order they were added.
export function toggleGroup(value, name) {
  // A comma would split the name into two groups, so it becomes a space.
  const n = String(name || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return groupTokens(value).join(', ');
  const tokens = groupTokens(value);
  const has = tokens.some(t => t.toLowerCase() === n.toLowerCase());
  return (has ? tokens.filter(t => t.toLowerCase() !== n.toLowerCase()) : [...tokens, n]).join(', ');
}

// Every group to offer in a picker: the ones in use across `values`, plus any
// already on this contact, once each (first spelling wins), A–Z.
export function groupOptions(values, current = '') {
  const seen = new Map();
  for (const t of [...values.flatMap(groupTokens), ...groupTokens(current)]) {
    if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

// → [{ label, items }], groups A–Z with "No group" last. Someone in two groups
// shows up in both tables — that's what grouping by a multi-valued field means,
// and hiding them from one would make that group's table look short.
// The order of `items` within each bucket is preserved.
export function bucketByGroup(items, tokensOf) {
  const buckets = new Map();
  const ungrouped = [];
  for (const item of items) {
    const tokens = [...new Set(tokensOf(item))];
    if (tokens.length === 0) { ungrouped.push(item); continue; }
    for (const t of tokens) {
      if (!buckets.has(t)) buckets.set(t, []);
      buckets.get(t).push(item);
    }
  }
  const out = [...buckets.keys()]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(label => ({ label, items: buckets.get(label) }));
  if (ungrouped.length) out.push({ label: NO_GROUP, items: ungrouped });
  return out;
}

// An event guest's tables when the People & Poll list is split. A group set on
// this event (`eventGroup`) wins outright — it's how you put someone somewhere
// other than their Friends group, and it puts them in that one table only.
// Otherwise their Friends groups; failing that, whatever their linked partner
// lands in, so someone who isn't in Friends follows the person they came with.
export function eventGroupsOf(member, friendGroup, partner, partnerFriendGroup) {
  const own = String(member?.eventGroup || '').trim();
  if (own) return [own];
  const fromFriends = groupTokens(friendGroup);
  if (fromFriends.length) return fromFriends;
  const partnerOwn = String(partner?.eventGroup || '').trim();
  if (partnerOwn) return [partnerOwn];
  return groupTokens(partnerFriendGroup);
}
