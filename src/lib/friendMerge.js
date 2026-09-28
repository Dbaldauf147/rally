// Finding and merging duplicate contacts on the Friends page.
//
// Pure — no Firestore — so it can be unit-tested; FriendsPage does the writes.
//
// A merge keeps one contact (its doc id survives, so anything already pointing
// at it keeps working) and folds the others into it:
//   • single-value fields (email, phone, birthday…) — the kept contact's value,
//     unless the user picked another one where they disagree; a blank is filled
//     from whichever duplicate has it.
//   • lists (tags, addresses, gift ideas, kids) — combined, repeats dropped.
//   • notes — each distinct note kept, one after another.
//   • Likes / Things I appreciate — sections with the same title combined.
// Then every reference to a removed contact is pointed at the kept one: other
// friends' "comes with" link, Reach Out rows and wedding guests (friendId).

const clean = (v) => String(v ?? '').trim();
const digits = (v) => clean(v).replace(/[^\d]/g, '');
const phoneKey = (v) => { const d = digits(v); return d.length >= 7 ? d.slice(-10) : ''; };
const nameKey = (v) => clean(v).toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

// The fields that hold one value, in the order the merge screen lists them.
export const SCALAR_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'workEmail', label: 'Work email' },
  { key: 'phone', label: 'Phone' },
  { key: 'group', label: 'Group' },
  { key: 'guest', label: 'Guest' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'birthday', label: 'Birthday' },
  { key: 'dob', label: 'Date of birth' },
  { key: 'anniversary', label: 'Anniversary' },
  { key: 'tier', label: 'Tier' },
  { key: 'linkedTo', label: 'Comes with' },
];
const LIST_KEYS = new Set(['tag', 'addresses', 'address', 'giftIdeas', 'kids', 'notes', 'profile', 'custom', 'createdAt', 'id']);

/* Groups of contacts that look like the same person: the same email (personal
 * or work), the same phone number (last ten digits), or the same name once case
 * and punctuation are ignored. Matches chain — A shares an email with B, B a
 * phone with C — so a group can be more than two. Each group carries why it
 * matched, for the list. */
export function findDuplicateGroups(friends) {
  const list = Array.isArray(friends) ? friends : [];
  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const reasons = new Map(); // root pair key -> Set
  const seen = new Map(); // "kind:value" -> first index
  const union = (a, b, why) => {
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
    const r = find(a);
    if (!reasons.has(r)) reasons.set(r, new Set());
    reasons.get(r).add(why);
  };
  list.forEach((f, i) => {
    const keys = [];
    for (const e of [f.email, f.workEmail]) if (clean(e)) keys.push(['email', clean(e).toLowerCase()]);
    if (phoneKey(f.phone)) keys.push(['phone', phoneKey(f.phone)]);
    if (nameKey(f.name)) keys.push(['name', nameKey(f.name)]);
    for (const [kind, value] of keys) {
      const k = `${kind}:${value}`;
      if (seen.has(k)) union(seen.get(k), i, kind);
      else seen.set(k, i);
    }
  });
  const groups = new Map();
  list.forEach((f, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(f);
  });
  // Reasons were recorded against whichever root was current at the time;
  // gather them up by the final root.
  const why = new Map();
  for (const [r, set] of reasons) {
    const root = find(r);
    if (!why.has(root)) why.set(root, new Set());
    for (const w of set) why.get(root).add(w);
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([r, members]) => ({ friends: members, reasons: [...(why.get(r) || [])].sort() }))
    .sort((a, b) => clean(a.friends[0].name).localeCompare(clean(b.friends[0].name)));
}

/* Where the contacts disagree: each single-value field that has more than one
 * distinct non-blank value, with those values. Compared loosely (case, and
 * phone punctuation) so "(555) 123-4567" and "555-123-4567" aren't a choice. */
export function mergeConflicts(friends) {
  const same = (key, v) => (key === 'phone' ? phoneKey(v) || clean(v) : clean(v).toLowerCase());
  const out = [];
  for (const { key, label } of SCALAR_FIELDS) {
    const values = [];
    const seen = new Set();
    for (const f of friends) {
      const v = clean(f[key]);
      if (!v) continue;
      const k = same(key, v);
      if (seen.has(k)) continue;
      seen.add(k);
      values.push({ value: v, from: f.id });
    }
    if (values.length > 1) out.push({ key, label, values });
  }
  return out;
}

function unionBy(lists, keyOf) {
  const out = [];
  const seen = new Set();
  for (const item of lists.flat()) {
    const k = keyOf(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function mergeProfiles(profiles) {
  const sections = [];
  for (const profile of profiles) {
    for (const s of Array.isArray(profile) ? profile : []) {
      const title = clean(s?.title);
      const existing = sections.find((x) => x.title.toLowerCase() === title.toLowerCase());
      const items = Array.isArray(s?.items) ? s.items : [];
      if (!existing) { sections.push({ ...s, title, items: [...items] }); continue; }
      const have = new Set(existing.items.map((it) => clean(it?.text).toLowerCase()));
      for (const it of items) {
        if (!have.has(clean(it?.text).toLowerCase())) existing.items.push(it);
      }
    }
  }
  return sections;
}

const addressList = (f) => {
  const list = Array.isArray(f.addresses) ? f.addresses.filter((a) => clean(a?.value)) : [];
  if (list.length === 0 && clean(f.address)) return [{ label: '', value: clean(f.address) }];
  return list;
};

/* The merged contact, to be written over `primary`. `choices` maps a field key
 * to the value picked for it on the merge screen. The result has no `id` —
 * the caller writes it to the primary's doc. */
export function mergeFriends(primary, others, choices = {}) {
  const all = [primary, ...others];
  const removedIds = new Set(others.map((f) => f.id));
  const out = {};

  // Anything this module doesn't know about survives from the kept contact
  // first, then from whichever duplicate has it.
  for (const f of [...all].reverse()) {
    for (const [k, v] of Object.entries(f)) {
      if (LIST_KEYS.has(k) || SCALAR_FIELDS.some((s) => s.key === k)) continue;
      if (v !== undefined && v !== null && v !== '') out[k] = v;
    }
  }

  for (const { key } of SCALAR_FIELDS) {
    const picked = choices[key];
    out[key] = picked !== undefined ? picked : (all.map((f) => clean(f[key])).find(Boolean) || '');
  }
  // A contact can't come with itself, or with someone being merged into it.
  if (out.linkedTo && (out.linkedTo === primary.id || removedIds.has(out.linkedTo))) {
    out.linkedTo = all.map((f) => f.linkedTo).find((id) => id && id !== primary.id && !removedIds.has(id)) || '';
  }
  out.email = out.email.toLowerCase();
  out.workEmail = out.workEmail.toLowerCase();

  const tags = unionBy(all.map((f) => clean(f.tag).split(';').map((t) => t.trim())), (t) => t.toLowerCase());
  out.tag = tags.join(';');

  out.addresses = unionBy(all.map(addressList), (a) => clean(a.value).toLowerCase().replace(/\s+/g, ' '));
  out.address = out.addresses[0]?.value || '';

  out.giftIdeas = unionBy(all.map((f) => (Array.isArray(f.giftIdeas) ? f.giftIdeas : [])), (g) => clean(g).toLowerCase());

  // Kids by name; a birthday one record has and the other doesn't is kept.
  const kids = [];
  for (const k of all.flatMap((f) => (Array.isArray(f.kids) ? f.kids : []))) {
    const name = clean(k?.name);
    if (!name) continue;
    const have = kids.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!have) kids.push({ name, birthday: clean(k.birthday) });
    else if (!have.birthday && clean(k.birthday)) have.birthday = clean(k.birthday);
  }
  out.kids = kids;

  out.notes = unionBy(all.map((f) => [clean(f.notes)]), (n) => n.toLowerCase()).join('\n\n');

  out.profile = mergeProfiles(all.map((f) => f.profile));

  const custom = {};
  for (const f of [...all].reverse()) {
    for (const [k, v] of Object.entries(f.custom && typeof f.custom === 'object' ? f.custom : {})) {
      if (v !== undefined && v !== null && v !== '' && v !== false) custom[k] = v;
    }
  }
  out.custom = custom;

  // The earliest the person was known about.
  const created = all.map((f) => f.createdAt).filter(Boolean).sort()[0];
  if (created) out.createdAt = created;
  return out;
}

/* A list of records with a `friendId` (Reach Out rows, wedding guests) with the
 * removed contacts' ids pointed at the kept one. `changed` says whether it's
 * worth writing back. */
export function repointFriendIds(list, removedIds, keptId) {
  const removed = new Set(removedIds);
  let changed = false;
  const next = (Array.isArray(list) ? list : []).map((c) => {
    if (c && removed.has(c.friendId)) { changed = true; return { ...c, friendId: keptId }; }
    return c;
  });
  return { next, changed };
}
