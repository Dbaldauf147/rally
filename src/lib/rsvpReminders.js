// Automatic email reminders to guests who haven't said whether they're coming.
//
// The counterpart, for an event whose date is already set, of the "please
// vote" reminders in lib/autoReminders.js. Stored on the event as
//   rsvpReminders: { enabled, intervals: [3, 7], startedAt }
// and worked through once a day by api/check-reminders.js: each guest with no
// answer gets the 1st reminder `intervals[0]` days after it was switched on,
// the 2nd `intervals[1]` days after, and so on, stopping as soon as they
// answer or the event has passed. Per guest, `rsvpRemindersSent` counts them
// and `rsvpReminderLog` keeps the dates.
import { buildVoteStats } from './attendance.js';
import { isComingOrMaybe } from './eventReminders.js';

export const DEFAULT_RSVP_REMINDER_INTERVALS = [3, 7];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days as positive whole numbers, smallest first, no repeats. */
export function rsvpIntervals(rr) {
  const list = Array.isArray(rr?.intervals) ? rr.intervals : DEFAULT_RSVP_REMINDER_INTERVALS;
  return [...new Set(list.map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
}

/** "3, 7 and 14" typed into the settings → [3, 7, 14]. */
export function parseDayList(text) {
  return rsvpIntervals({ intervals: String(text || '').split(/[^0-9]+/).filter(Boolean) });
}

/**
 * Has this guest answered in any way? A manual Going / Not going, an RSVP, a
 * vote on any date, or riding along as a linked +1 of somebody who is coming
 * all count — the same signals the rest of the event page reads.
 */
export function hasResponded(uid, m, members = {}, voteStats = {}) {
  if (!m || typeof m !== 'object') return true;
  if (m.attendance === 'going' || m.attendance === 'notgoing') return true;
  if (m.rsvp === 'yes' || m.rsvp === 'maybe' || m.rsvp === 'no') return true;
  if ((voteStats[uid]?.total || 0) > 0) return true;
  return isComingOrMaybe(uid, m, members, voteStats);
}

/**
 * Who a reminder could go to: no answer yet, an email address, not the
 * organizer, and not somebody the event is hidden from. One address gets one
 * email however many rows it sits under. `options` are the event's dateOptions.
 */
export function rsvpReminderRecipients(event, options = []) {
  const members = event?.members || {};
  const voteStats = buildVoteStats(options);
  const hiddenFrom = new Set((Array.isArray(event?.hiddenFrom) ? event.hiddenFrom : [])
    .map((e) => String(e || '').trim().toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const [uid, m] of Object.entries(members)) {
    if (!m || typeof m !== 'object' || !m.email || m.role === 'owner') continue;
    const email = String(m.email).trim().toLowerCase();
    if (hiddenFrom.has(email) || seen.has(email)) continue;
    if (hasResponded(uid, m, members, voteStats)) continue;
    seen.add(email);
    out.push([uid, m]);
  }
  return out;
}

/**
 * The reminder due for one guest today, or null. `eventDate` is the event's
 * date as a Date (the current occurrence, for a yearly event); once it has
 * passed nothing more is sent.
 */
export function dueRsvpReminder(event, member, now = new Date(), eventDate = null) {
  const rr = event?.rsvpReminders;
  if (!rr?.enabled || !rr.startedAt || event.cancelled || event.stage !== 'finalized') return null;
  const intervals = rsvpIntervals(rr);
  const sent = member?.rsvpRemindersSent || 0;
  if (sent >= intervals.length) return null;
  const startedAt = new Date(rr.startedAt);
  if (isNaN(startedAt)) return null;
  if (eventDate && eventDate.getTime() + DAY_MS < now.getTime()) return null;
  // A minute's grace: the daily check lands a few seconds after the hour, and
  // so does a startedAt stamped by an earlier check.
  if (Math.floor((now - startedAt + 60 * 1000) / DAY_MS) < intervals[sent]) return null;
  return { reminderNum: sent + 1, totalReminders: intervals.length };
}

/** The days the reminders go out, for the settings: [{ n, at: Date, past }]. */
export function rsvpReminderSchedule(rr, now = new Date()) {
  const startedAt = rr?.startedAt ? new Date(rr.startedAt) : now;
  const base = isNaN(startedAt) ? now : startedAt;
  return rsvpIntervals(rr).map((n) => {
    const at = new Date(base.getTime() + n * DAY_MS);
    return { n, at, past: at.getTime() <= now.getTime() };
  });
}

/** Are any automatic email reminders on for the stage this event is in? */
export function remindersOn(event, stage) {
  return stage === 'finalized'
    ? !!event?.rsvpReminders?.enabled || !!event?.eventReminders?.enabled
    : !!event?.autoReminders?.enabled;
}
