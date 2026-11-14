// "Show this on my dashboard from…" — holding an event back until it's worth
// looking at.
//
// Halloween is the case this exists for: it's on the calendar all year, but
// nobody wants its card on the dashboard in February. So a person can pick a
// day for the event to turn up, and until then the dashboard keeps it in a
// collapsed "Showing later" group instead of on the board.
//
// It is one person's view, not a property of the event: stored per user under
// `dashboardFrom.<uid>`, so holding an event back on your dashboard changes
// nothing for the other guests. And it is the dashboard only — the calendar,
// plans, reminders and the event page all carry on as before.
//
// The stored value is { date, daysBefore }:
//   date        'YYYY-MM-DD', the day that was picked
//   daysBefore  how far ahead of the event's start that day was, or null when
//               the event had no date yet
// A one-off event uses `date`. A yearly event uses `daysBefore`, counted back
// from whichever occurrence is coming up, so the event tucks itself away again
// after each year's date and returns the same distance ahead of the next one.

//
// Anything else can be told to come round every year by the calendar instead:
// { yearly: true, until } alongside `date`. Then the event shows from that
// month and day until the `until` month and day, every year, and waits under
// "Showing later" the rest of the time. That's for the event with no date of
// its own to count back from — a Secret Santa whose date is voted on each
// year should still turn up every November. A window may run over New Year
// (from Dec 1 until Jan 5).

import { isoToDate, dateToISO } from './dateInput';
import { isRecurring } from './recurrence';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value) {
  if (!value) return null;
  const d = value.toDate ? value.toDate() : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

const dayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Whole days between two local days. Rounded, so a daylight-saving change
// (a 23- or 25-hour day) in between doesn't shave one off.
const daysBetween = (from, to) => Math.round((dayOf(to) - dayOf(from)) / 86400000);

/** One person's stored setting, or null for none/junk. */
export function normalizeDashboardFrom(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!YMD.test(String(raw.date ?? '')) || !isoToDate(raw.date)) return null;
  const n = raw.daysBefore === null || raw.daysBefore === undefined || raw.daysBefore === ''
    ? NaN
    : Number(raw.daysBefore);
  const out = { date: raw.date, daysBefore: Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null };
  // Yearly needs both ends; half a window is treated as the one-off it also is.
  if (raw.yearly === true && YMD.test(String(raw.until ?? '')) && isoToDate(raw.until)) {
    out.yearly = true;
    out.until = raw.until;
  }
  return out;
}

// A stored day's month and day, placed in `year`. Feb 29 falls back to Feb 28.
function inYear(ymd, year) {
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  return new Date(year, m - 1, Math.min(d, new Date(year, m, 0).getDate()));
}

/**
 * Where `now` stands against a yearly window: { showing, start }. `start` is
 * the first day of the window we're in, or of the next one when we're between
 * windows.
 */
function yearlyWindow(setting, now) {
  const today = dayOf(now);
  const year = today.getFullYear();
  for (const y of [year - 1, year]) {
    const start = inYear(setting.date, y);
    let end = inYear(setting.until, y);
    if (end < start) end = inYear(setting.until, y + 1);
    if (start <= today && today <= end) return { showing: true, start };
  }
  const thisYear = inYear(setting.date, year);
  return { showing: false, start: thisYear > today ? thisYear : inYear(setting.date, year + 1) };
}

/** The value to store for a picked day; null when the field was left empty. */
export function buildDashboardFrom(showYmd, eventStart, { yearly = false, until = '' } = {}) {
  const show = isoToDate(showYmd);
  if (!show) return null;
  const start = toDate(eventStart);
  const lead = start ? daysBetween(show, start) : null;
  return normalizeDashboardFrom({ date: showYmd, daysBefore: lead !== null && lead >= 0 ? lead : null, yearly, until });
}

/**
 * The day (local midnight) this person's dashboard starts showing the event,
 * or null when they haven't asked for it to be held back.
 */
export function dashboardShowDay(event, uid, now = new Date()) {
  const setting = normalizeDashboardFrom(uid ? event?.dashboardFrom?.[uid] : null);
  if (!setting) return null;
  if (setting.yearly) return yearlyWindow(setting, now).start;
  const start = event?.dateTBD ? null : toDate(event?.date);
  if (start && setting.daysBefore !== null && isRecurring(event)) {
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() - setting.daysBefore);
  }
  return isoToDate(setting.date);
}

/** The same day as 'YYYY-MM-DD', for filling the form's field ('' for none). */
export function dashboardShowYmd(event, uid) {
  const setting = normalizeDashboardFrom(uid ? event?.dashboardFrom?.[uid] : null);
  // A yearly window is edited as the two days that were picked.
  if (setting?.yearly) return setting.date;
  const day = dashboardShowDay(event, uid);
  return day ? dateToISO(day) : '';
}

/**
 * Is the event still being held back from this person's dashboard?
 *
 * A show day that lands after the event itself is ignored (the event was moved
 * earlier since): it would keep the event off the dashboard until it was over.
 */
export function isShowingLater(event, uid, now = new Date()) {
  const setting = normalizeDashboardFrom(uid ? event?.dashboardFrom?.[uid] : null);
  if (setting?.yearly) return !yearlyWindow(setting, now).showing;
  const show = dashboardShowDay(event, uid, now);
  if (!show) return false;
  const start = event?.dateTBD ? null : toDate(event?.date);
  if (start && show > dayOf(start)) return false;
  return show > dayOf(now);
}

/** Splits a dashboard's events into the ones on show and the ones held back. */
export function splitShowingLater(events, uid, now = new Date()) {
  const showing = [];
  const later = [];
  (events || []).forEach((e) => (isShowingLater(e, uid, now) ? later : showing).push(e));
  later.sort((a, b) => dashboardShowDay(a, uid, now) - dashboardShowDay(b, uid, now));
  return { showing, later };
}
