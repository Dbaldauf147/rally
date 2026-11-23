// A friend's first, middle and last name.
//
// `name` is still the friend's name everywhere else — matching a guest to a
// contact, the wedding list, emails, sorting — so it stays the one stored
// truth, and the three parts are kept beside it as `firstName`, `middleName`
// and `lastName`. The pop-up edits the parts and writes `name` as the three
// joined, so the two can't disagree after a save there.
//
// They can after a save anywhere else (an import, a merge, the wedding list
// renaming someone). So the parts are only believed while they still spell
// `name`; otherwise, and for every contact from before the parts existed,
// they are worked out from `name`.
//
// Pure: no React, no Firestore.

const tidy = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

/** The full name the three parts spell. */
export function joinName({ firstName, middleName, lastName } = {}) {
  return [firstName, middleName, lastName].map(tidy).filter(Boolean).join(' ');
}

/**
 * A full name as parts: the first word, the last word, and whatever is
 * between. One word is a first name alone. A guess — "Mary Ann Smith" may be
 * Mary Ann — but joining the parts always gives the name back, so opening a
 * contact never renames them.
 */
export function splitName(name) {
  const words = tidy(name).split(' ').filter(Boolean);
  return {
    firstName: words[0] || '',
    middleName: words.slice(1, -1).join(' '),
    lastName: words.length > 1 ? words[words.length - 1] : '',
  };
}

/** A friend's parts: the stored ones while they still spell the name. */
export function namePartsOf(friend) {
  const stored = {
    firstName: tidy(friend?.firstName),
    middleName: tidy(friend?.middleName),
    lastName: tidy(friend?.lastName),
  };
  const name = tidy(friend?.name);
  if (joinName(stored) && (!name || joinName(stored) === name)) return stored;
  return splitName(name);
}
