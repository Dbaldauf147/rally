// All-day events.
//
// The event form's time field is optional; leaving it blank stores the date at
// local midnight and sets `allDay: true`. Every surface that prints a clock has
// to ask first, or an all-day event reads as "12:00 AM" — which looks like a
// real (and wrong) start time rather than "no time set".
import { format } from 'date-fns';

const TIME_FORMAT = 'h:mm a';

/** True when the event has no time of day, only a date. */
export function isAllDay(event) {
  return !!event?.allDay;
}

/**
 * "Saturday, July 4, 2026 · 6:00 PM", or just the date part for an all-day
 * event. `pattern` is the date half — the time is appended only when there is
 * one.
 */
export function formatWhen(event, date, pattern) {
  if (!date || isNaN(date.getTime())) return '';
  const day = format(date, pattern);
  return isAllDay(event) ? day : `${day} · ${format(date, TIME_FORMAT)}`;
}

/* A usable Date, or null.
 *
 * `new Date(null)` is the epoch rather than an invalid date, so a missing value
 * passes an isNaN check and comes back as 7pm on New Year's Eve 1969 in the
 * timezones west of UTC. Nullish has to be rejected before parsing.
 */
function toDate(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (value == null || value === '') return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** 'HH:mm' for a time input, or '' when the event has no time of day. */
export function timeInputValue(event, date) {
  if (isAllDay(event)) return '';
  const d = toDate(date);
  if (!d) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * The same calendar day at a different time of day. A blank time means
 * midnight, which is what an all-day event stores.
 *
 * The day is taken from the existing date rather than rebuilt from a string:
 * finalizing writes noon local, and re-parsing that through UTC is how an
 * evening event ends up on the day before.
 */
export function withTimeOfDay(date, hhmm) {
  const base = toDate(date);
  if (!base) return null;
  const [h, m] = String(hhmm ?? '').split(':').map(Number);
  const out = new Date(base);
  out.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return out;
}
