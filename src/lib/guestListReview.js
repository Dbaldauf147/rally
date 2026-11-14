// A yearly event's guest list, confirmed once a year.
//
// A yearly event is one doc (lib/recurrence.js), so its `members` map simply
// carries over from one occurrence to the next — along with everyone's RSVP
// from the year before. With this option on, last year's list is treated as a
// SUGGESTION for the new year: the organizer is asked to tick who is invited
// again, and confirming starts the year clean (unticked people come off, the
// rest go back to "hasn't answered").
//
// Stored on the event as
//   guestListReview: { enabled: true, confirmedYear: 2026 }
// `confirmedYear` is the latest occurrence year whose list the organizer has
// signed off. The list is due for review whenever the occurrence now showing
// is in a later year than that.

import { isRecurring } from './recurrence';

// Per-year answers on a guest that shouldn't follow them into the next year.
// Kept in step with ROUND_MEMBER_FIELDS in lib/pollSeries.js, which does the
// same job for a poll-based repeat.
export const YEAR_MEMBER_FIELDS = ['emailed', 'texted', 'skipVote', 'foodOrder', 'attendance', 'lastAutoReminder', 'autoRemindersSent'];

/** The stored setting, or null when the option is off or the value is junk. */
export function normalizeGuestListReview(raw) {
  if (!raw || typeof raw !== 'object' || raw.enabled !== true) return null;
  const n = Number(raw.confirmedYear);
  const confirmedYear = raw.confirmedYear != null && Number.isFinite(n) ? Math.trunc(n) : null;
  return { enabled: true, confirmedYear };
}

/**
 * The year whose guest list is waiting to be confirmed, or null when nothing
 * is due. `event` is expected the way useEvents hands it out, with
 * `occurrenceYear` set to the occurrence that is running or coming next.
 */
export function guestListReviewYear(event) {
  const review = normalizeGuestListReview(event?.guestListReview);
  if (!review || !isRecurring(event) || event.dateTBD || event.cancelled) return null;
  const year = Number(event.occurrenceYear);
  if (!Number.isFinite(year)) return null;
  if (review.confirmedYear !== null && review.confirmedYear >= year) return null;
  return year;
}

/**
 * What the form saves. Turning the option on signs off the year in the form —
 * the list being built right now IS that year's list — so the first prompt
 * comes when the event rolls over to the next one. An already-confirmed later
 * year is never walked back by an edit.
 */
export function guestListReviewForSave(enabled, saved, formYear) {
  if (!enabled) return null;
  const prev = normalizeGuestListReview(saved);
  if (prev) return prev;
  return { enabled: true, confirmedYear: Number.isFinite(Number(formYear)) ? Math.trunc(Number(formYear)) : null };
}

/** Everyone who can be carried over or dropped: all guests but the organizer, by name. */
export function suggestedGuests(members) {
  return Object.entries(members && typeof members === 'object' ? members : {})
    .filter(([, m]) => m && typeof m === 'object' && m.role !== 'owner')
    .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
}

/**
 * The event update that confirms `year`'s guest list.
 *
 * `keepKeys` are the suggested guests staying on; every other non-organizer
 * comes off. Writes are per-field (see lib/members.js — replacing a member
 * wholesale has wiped details before), so `remove` is passed in as the
 * Firestore deleteField() sentinel. Returns the field updates plus the keys
 * that were removed, which the caller also takes out of `memberUids` and the
 * date-option votes.
 */
export function confirmGuestListUpdates(event, keepKeys, year, remove) {
  const keep = new Set(keepKeys);
  const updates = { guestListReview: { enabled: true, confirmedYear: year } };
  const removed = [];
  const all = Object.entries(event?.members && typeof event.members === 'object' ? event.members : {})
    .filter(([, m]) => m && typeof m === 'object');

  for (const [key, m] of all) {
    if (m.role !== 'owner' && !keep.has(key)) removed.push(key);
  }
  const gone = new Set(removed);

  for (const [key, m] of all) {
    if (gone.has(key)) {
      updates[`members.${key}`] = remove;
      continue;
    }
    // The organizer is going, as on any new event; everyone else is asked again.
    updates[`members.${key}.rsvp`] = m.role === 'owner' ? 'yes' : 'pending';
    for (const f of YEAR_MEMBER_FIELDS) {
      if (m[f] !== undefined) updates[`members.${key}.${f}`] = remove;
    }
    // A plus-one link to somebody who is no longer coming would dangle.
    if (m.plusOneOf && gone.has(m.plusOneOf)) updates[`members.${key}.plusOneOf`] = remove;
  }
  return { updates, removed };
}
