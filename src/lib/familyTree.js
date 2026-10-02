// A friend's family tree, kept on the friend doc as `familyTree`.
//
// Pure — no Firestore, no DOM — so it can be unit-tested; FamilyTree.jsx draws
// it and FriendsPage writes it.
//
// The tree is laid out by generation relative to the friend rather than as a
// web of parent links: grandparents on top, then parents, the friend's own row
// (siblings, the friend and their partner, cousins), kids, grandkids. That's
// what a person can fill in from memory — "her mom is Linda, her brother is
// Tom" — without having to say whose child each cousin is.
//
// Three kinds of people appear, and only one is stored here:
//   • the friend, and their partner — from the friend record itself (the name,
//     and the "comes with" contact or the Guest field). Their photos live here
//     as selfPhoto / partnerPhoto.
//   • kids — the friend's Kids list stays the one list of kids; a kid's photo
//     rides on the kid (kids[].photoId).
//   • everyone else — `people`, each { id, name, relation, photoId }.

export const RELATIONS = [
  { key: 'grandparent', label: 'Grandparent', plural: 'Grandparents', gen: -2 },
  { key: 'parent', label: 'Parent', plural: 'Parents', gen: -1 },
  { key: 'aunt-uncle', label: 'Aunt / Uncle', plural: 'Aunts & uncles', gen: -1 },
  { key: 'sibling', label: 'Sibling', plural: 'Siblings', gen: 0 },
  { key: 'cousin', label: 'Cousin', plural: 'Cousins', gen: 0 },
  { key: 'niece-nephew', label: 'Niece / Nephew', plural: 'Nieces & nephews', gen: 1 },
  { key: 'grandkid', label: 'Grandkid', plural: 'Grandkids', gen: 2 },
  { key: 'pet', label: 'Pet', plural: 'Pets', gen: 1 },
  { key: 'other', label: 'Other', plural: 'Other family', gen: 0 },
];
const BY_KEY = new Map(RELATIONS.map((r) => [r.key, r]));
export const relationLabel = (key) => BY_KEY.get(key)?.label || 'Other';

// The generations, top to bottom, and what each row is called on a phone.
export const GENERATIONS = [
  { gen: -2, label: 'Grandparents' },
  { gen: -1, label: 'Parents, aunts & uncles' },
  { gen: 0, label: 'Their generation' },
  { gen: 1, label: 'Kids' },
  { gen: 2, label: 'Grandkids' },
];

let seq = 0;
export function makeId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  seq += 1;
  return `ft${Date.now().toString(36)}${seq}`;
}

const clean = (v) => String(v ?? '').trim();

// Whatever came off the doc — missing, half-written, from an older build —
// as a tree the rest of this file can trust.
export function normalizeFamilyTree(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const people = (Array.isArray(t.people) ? t.people : [])
    .filter((p) => p && typeof p === 'object' && clean(p.name))
    .map((p) => ({
      id: clean(p.id) || makeId(),
      name: clean(p.name),
      relation: BY_KEY.has(p.relation) ? p.relation : 'other',
      photoId: clean(p.photoId),
    }));
  return { selfPhoto: clean(t.selfPhoto), partnerPhoto: clean(t.partnerPhoto), people };
}

export function addPerson(tree, name, relation) {
  const t = normalizeFamilyTree(tree);
  const n = clean(name);
  if (!n) return t;
  return { ...t, people: [...t.people, { id: makeId(), name: n, relation: BY_KEY.has(relation) ? relation : 'other', photoId: '' }] };
}

export function updatePerson(tree, id, patch) {
  const t = normalizeFamilyTree(tree);
  return { ...t, people: t.people.map((p) => (p.id === id ? normalizeFamilyTree({ people: [{ ...p, ...patch }] }).people[0] || p : p)) };
}

export function removePerson(tree, id) {
  const t = normalizeFamilyTree(tree);
  return { ...t, people: t.people.filter((p) => p.id !== id) };
}

/* Everyone in the tree, as rows by generation, each person as the view needs
 * them: { key, name, relation label, photoId, kind }. `kind` says where an
 * edit goes — 'self' | 'partner' | 'kid' | 'person'. `partnerName` is the
 * friend's partner, if they have one. Empty generations are left out, except
 * the friend's own, which always has the friend in it.
 *
 * The friend's row reads siblings, then the couple, then cousins and anyone
 * else, so the couple sits in the middle of the tree. */
export function familyRows({ name, tree, kids, partnerName }) {
  const t = normalizeFamilyTree(tree);
  const person = (p) => ({ key: `person:${p.id}`, id: p.id, name: p.name, relation: relationLabel(p.relation), photoId: p.photoId, kind: 'person', relationKey: p.relation });
  const of = (keys) => t.people.filter((p) => keys.includes(p.relation)).map(person);

  const couple = [{ key: 'self', name: clean(name) || 'Them', relation: 'Them', photoId: t.selfPhoto, kind: 'self' }];
  if (clean(partnerName)) couple.push({ key: 'partner', name: clean(partnerName), relation: 'Partner', photoId: t.partnerPhoto, kind: 'partner' });

  const kidPeople = (Array.isArray(kids) ? kids : [])
    .map((k, index) => ({ k, index }))
    .filter(({ k }) => clean(k?.name))
    .map(({ k, index }) => ({ key: `kid:${index}`, index, name: clean(k.name), relation: 'Kid', photoId: clean(k.photoId), kind: 'kid' }));

  const rows = [
    { gen: -2, people: of(['grandparent']) },
    { gen: -1, people: [...of(['parent']), ...of(['aunt-uncle'])] },
    { gen: 0, people: [...of(['sibling']), ...couple, ...of(['cousin', 'other'])], couple: couple.map((c) => c.key) },
    { gen: 1, people: [...kidPeople, ...of(['niece-nephew', 'pet'])] },
    { gen: 2, people: of(['grandkid']) },
  ];
  const labels = new Map(GENERATIONS.map((g) => [g.gen, g.label]));
  return rows
    .filter((r) => r.gen === 0 || r.people.length > 0)
    .map((r) => ({ ...r, label: labels.get(r.gen) }));
}

// Every photo the tree refers to — what to clean up when the tree goes.
export function treePhotoIds(tree, kids) {
  const t = normalizeFamilyTree(tree);
  return [t.selfPhoto, t.partnerPhoto, ...t.people.map((p) => p.photoId), ...(Array.isArray(kids) ? kids : []).map((k) => clean(k?.photoId))].filter(Boolean);
}
