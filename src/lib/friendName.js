// A friend's first, middle and last name.
//
// `name` is the friend's name everywhere on the site — the contacts list,
// guest lists, the wedding list, emails, matching a guest to a contact — and
// it is the first and last name only. The middle name is kept beside it
// (`middleName`, with `firstName` and `lastName`) and shown in one place: the
// friend pop-up, which edits the three and writes `name` from the outer two.
//
// `name` can also be changed somewhere else (an import, a merge, the wedding
// list renaming someone). So the stored parts are only believed while they
// still spell it; otherwise, and for every contact from before the parts
// existed, they are worked out from `name`.
//
// Pure: no React, no Firestore.

const tidy = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const join = (...parts) => parts.map(tidy).filter(Boolean).join(' ');

/** The name shown and stored as `name`: first and last, no middle. */
export function joinName({ firstName, lastName } = {}) {
  return join(firstName, lastName);
}

/**
 * A full name as parts: the last word is the last name and the rest the
 * first. Never a middle name — that is only ever what was typed into the
 * pop-up's Middle field — so joining the parts always gives the name back,
 * and opening a contact never renames them.
 */
export function splitName(name) {
  const words = tidy(name).split(' ').filter(Boolean);
  return {
    firstName: words.length > 1 ? words.slice(0, -1).join(' ') : (words[0] || ''),
    middleName: '',
    lastName: words.length > 1 ? words[words.length - 1] : '',
  };
}

const storedParts = (friend) => ({
  firstName: tidy(friend?.firstName),
  middleName: tidy(friend?.middleName),
  lastName: tidy(friend?.lastName),
});
// For a short while the pop-up wrote `name` with the middle name in it.
const withMiddle = (p) => join(p.firstName, p.middleName, p.lastName);

/** A friend's parts: the stored ones while they still spell the name. */
export function namePartsOf(friend) {
  const stored = storedParts(friend);
  const name = tidy(friend?.name);
  const outer = joinName(stored);
  if (outer && (!name || outer === name || withMiddle(stored) === name)) return stored;
  return splitName(name);
}

/**
 * The name a contact should have once its middle name is taken out of it —
 * or null when there is nothing to take out. Only for a `name` that is
 * exactly the three stored parts: one that merely has three words in it is
 * left alone, since nothing says the one between is a middle name.
 */
export function nameWithoutMiddle(friend) {
  const stored = storedParts(friend);
  const name = tidy(friend?.name);
  const outer = joinName(stored);
  if (!stored.middleName || !outer || outer === name) return null;
  return withMiddle(stored) === name ? outer : null;
}

/**
 * Event guests to rename along with those contacts. `renames` is
 * [{ from, to }]; `members` is an event's members map. Only a guest whose
 * name is exactly the old one is touched. { 'members.<key>.name': to }
 */
export function memberRenames(members, renames) {
  const to = new Map(renames.map((r) => [tidy(r.from).toLowerCase(), r.to]));
  const out = {};
  for (const [key, m] of Object.entries(members || {})) {
    if (!m || typeof m !== 'object') continue;
    const next = to.get(tidy(m.name).toLowerCase());
    if (next && next !== m.name) out[`members.${key}.name`] = next;
  }
  return out;
}
