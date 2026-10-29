// Automatic "it's coming up" emails to the people who said yes or maybe.
//
// The poll reminders (autoReminders.js) chase whoever still has a date to
// answer, and stop once a date is chosen. These start where those end: the
// event is finalized, and everyone who's in — or might be — hears about it a
// few days before. Stored on the event as eventReminders: { enabled, daysBefore },
// and sent by the same daily check (api/check-reminders.js).
//
// Pure: no React, no Firestore.
import { buildVoteStats, isYesMaybe } from './attendance.js';

// Days before the event that a reminder goes out.
export const DEFAULT_EVENT_REMINDER_DAYS = [7, 1];

// Event dates carry no time zone of their own; everyone planning on Rally is
// on Eastern time, which is what the other daily jobs count days in too.
export const EVENT_REMINDER_TIME_ZONE = 'America/New_York';
const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value) {
  if (value == null || value === '') return null;
  const d = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// 'YYYY-MM-DD' for the calendar day `date` falls on in Eastern time.
export function dayKey(date, timeZone = EVENT_REMINDER_TIME_ZONE) {
  const d = toDate(date);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const keyToUtc = (key) => Date.parse(`${key}T00:00:00Z`);

// Calendar days from today to the event's day: 0 on the day, 1 the day before,
// negative once it has passed. null when the event has no usable date.
export function daysUntil(eventDate, now = new Date()) {
  const ev = dayKey(eventDate);
  const today = dayKey(now);
  if (!ev || !today) return null;
  return Math.round((keyToUtc(ev) - keyToUtc(today)) / DAY_MS);
}

// The reminder days as whole numbers, largest first, no repeats or blanks.
export function reminderDays(er) {
  const list = Array.isArray(er?.daysBefore) ? er.daysBefore : DEFAULT_EVENT_REMINDER_DAYS;
  return [...new Set(list.map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n) && n >= 0))].sort((a, b) => b - a);
}

/* Is this person coming, or might they be? The same order the event page
   uses for Text Yeses & Maybes: a manual Going / Not going wins, then an
   explicit RSVP, then the date votes (with a linked +1 riding on their
   partner's). */
export function isComingOrMaybe(uid, m, members = {}, voteStats = {}) {
  if (!m || typeof m !== 'object') return false;
  if (m.attendance === 'going') return true;
  if (m.attendance === 'notgoing') return false;
  if (m.rsvp === 'yes' || m.rsvp === 'maybe') return true;
  if (m.rsvp === 'no') return false;
  return isYesMaybe(uid, m, members, voteStats);
}

/* Who gets the reminder: a yes or maybe with an email, who isn't the organizer
   sending it, and isn't somebody the event is hidden from (a reminder would
   give a surprise away). One email address gets one email, however many
   member rows it appears under. `options` are the event's dateOptions. */
export function eventReminderRecipients(event, options = []) {
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
    if (!isComingOrMaybe(uid, m, members, voteStats)) continue;
    seen.add(email);
    out.push([uid, m]);
  }
  return out;
}

// The log entry for "the N-days-before reminder for the event on this day".
// Keyed to the day, so moving the event re-arms every reminder.
export const reminderLogKey = (eventDay, n) => `${eventDay}:${n}`;

/* The reminder due for one member today, or null.

   Only one email goes out per day: if the schedule was switched on late
   (three days out, with a 7-day reminder never sent) the one sent stands in
   for every reminder it has caught up on, so the 7-day doesn't arrive the
   morning after as well. `logKeys` are all of those, to record as sent. */
export function dueEventReminder(event, member, now = new Date()) {
  const er = event?.eventReminders;
  if (!er?.enabled || event.cancelled || event.stage !== 'finalized') return null;
  const days = daysUntil(event.date, now);
  if (days == null || days < 0) return null;
  const eventDay = dayKey(event.date);
  const log = new Set(Array.isArray(member?.eventReminderLog) ? member.eventReminderLog : []);
  const pending = reminderDays(er).filter((n) => n >= days && !log.has(reminderLogKey(eventDay, n)));
  if (!pending.length) return null;
  return { daysAway: days, logKeys: pending.map((n) => reminderLogKey(eventDay, n)) };
}

/* The days the reminders go out for this event, for the settings panel:
   [{ n, day: 'YYYY-MM-DD', past }]. */
export function eventReminderSchedule(event, now = new Date()) {
  const eventDay = dayKey(event?.date);
  if (!eventDay) return [];
  const today = dayKey(now);
  return reminderDays(event?.eventReminders).map((n) => {
    const day = new Date(keyToUtc(eventDay) - n * DAY_MS).toISOString().slice(0, 10);
    return { n, day, past: day < today };
  });
}

// How many reminders this member has been sent for the event as it's dated now.
export function eventRemindersSentFor(event, member) {
  const eventDay = dayKey(event?.date);
  const log = Array.isArray(member?.eventReminderLog) ? member.eventReminderLog : [];
  return eventDay ? log.filter((k) => String(k).startsWith(`${eventDay}:`)).length : 0;
}
