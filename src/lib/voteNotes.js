// A note about somebody's answer on a date — "driving up after work", "only if
// the kids can come" — kept beside the vote it is about.
//
// It lives on the vote entry itself (`votes.{uid}.note` on the dateOption doc)
// rather than in a map of its own, because it is a fact about that answer on
// that day and nothing else. That means every write that touches a vote has to
// MERGE rather than replace: `{ votes.abc: { vote, name } }` overwrites the
// whole entry and takes the note with it, which is how the note would quietly
// disappear the next time anyone tapped the cell. The builders here always
// write field paths one level deeper, so two writers never clobber each other.
//
// `del` is Firestore's deleteField() sentinel, passed in so this file stays
// plain data and can be tested without a database.

export const noteOf = (entry) => String(entry?.note || '').trim();

// Whether the entry carries an actual answer. A cleared vote can leave an entry
// behind that holds only a note, and that is not a vote.
export const hasVote = (entry) => !!entry?.vote && entry.vote !== 'none';

/* The update for setting (or clearing) somebody's vote on a date.
 *
 * Clearing keeps a note that is already there: the answer changed, what you
 * wrote down about it didn't, and losing a sentence you typed because the cell
 * cycled past "no vote" would be its own small betrayal. With no note there is
 * nothing left to keep, so the entry goes.
 */
export function voteUpdate(uid, vote, name, entry, del) {
  const path = `votes.${uid}`;
  if (!vote || vote === 'none') {
    return noteOf(entry)
      ? { [`${path}.vote`]: del }
      : { [path]: del };
  }
  return { [`${path}.vote`]: vote, [`${path}.name`]: name || '' };
}

/* The update for writing (or removing) the note on somebody's answer.
 *
 * A note can be written where there is no vote yet — annotating "asked, waiting
 * to hear" is a perfectly good thing to do before an answer exists — and the
 * name rides along so the entry still says who it belongs to. Removing the last
 * note from an entry with no vote takes the entry with it, so an empty shell
 * isn't left behind for the voter lists to count.
 */
export function noteUpdate(uid, note, name, entry, del) {
  const path = `votes.${uid}`;
  const text = String(note || '').trim();
  if (!text) {
    return hasVote(entry) ? { [`${path}.note`]: del } : { [path]: del };
  }
  return { [`${path}.note`]: text, [`${path}.name`]: name || entry?.name || '' };
}
