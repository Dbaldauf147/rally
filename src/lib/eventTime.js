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
