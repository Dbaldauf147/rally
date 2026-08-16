// Annual recurrence for events.
//
// A recurring event is stored as ONE Firestore doc: its `date`/`endDate` hold a
// concrete occurrence (the anchor — time of day and length live there) and a
// `recurrence` rule says how that repeats every year. Occurrences are computed
// on read rather than written out as extra docs, so a yearly event never
// litters the events collection and editing the series is a single write.
//
// Two ways to say "every year":
//   { mode: 'date',    month: 7,  day: 4 }              → every July 4
//   { mode: 'weekday', month: 9,  week: 3, weekday: 6 } → 3rd Saturday of September
//
// `month` is 1-12 (human-readable in the Firestore console, converted to JS's
// 0-11 at the edges of this module). `weekday` is 0=Sun..6=Sat. `week` is 1-4,
// or -1 for "last" — a "5th" ordinal is deliberately not offered since most
// months don't have one.

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// -1 ("last") is kept at the end so the picker reads first → last.
export const WEEK_ORDINALS = [
  { value: 1, label: 'first' },
  { value: 2, label: 'second' },
  { value: 3, label: 'third' },
  { value: 4, label: 'fourth' },
  { value: -1, label: 'last' },
];

// Multi-day events longer than this are treated as bad data (a stale endDate),
// matching the guard the dashboard and event detail already apply.
const MAX_SPAN_DAYS = 60;

function toDate(value) {
  if (!value) return null;
  const d = value.toDate ? value.toDate() : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

// nth weekday of a month. weekday: 0=Sun..6=Sat. n: 1-based, or -1 for the last.
function nthWeekday(year, monthIndex, weekday, n) {
  if (n < 0) {
    const last = new Date(year, monthIndex + 1, 0);
    const offset = (last.getDay() - weekday + 7) % 7;
    return new Date(year, monthIndex, last.getDate() - offset);
  }
  const first = new Date(year, monthIndex, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, monthIndex, 1 + offset + (n - 1) * 7);
}

// Out-of-range values are rejected rather than clamped: a month of 44 is
// corrupt data, and quietly turning it into December would put the series on a
// date nobody picked.
function intInRange(value, min, max) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/** True when the event carries a usable annual recurrence rule. */
export function isRecurring(event) {
  return !!normalizeRecurrence(event?.recurrence);
}

/**
 * Validates/repairs a stored rule. Returns null for anything that isn't an
 * annual rule we can compute, so callers can treat "no rule" and "junk rule"
 * the same way.
 */
export function normalizeRecurrence(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.freq !== 'yearly') return null;

  const month = intInRange(raw.month, 1, 12);
  if (month === null) return null;

  const startYear = Number.isFinite(Number(raw.startYear)) ? Math.trunc(Number(raw.startYear)) : null;
  const endYearRaw = Number.isFinite(Number(raw.endYear)) ? Math.trunc(Number(raw.endYear)) : null;
  // An endYear before the series starts would silently kill every occurrence;
  // drop it rather than render a series that can never happen.
  const endYear = endYearRaw !== null && startYear !== null && endYearRaw < startYear ? null : endYearRaw;

  if (raw.mode === 'weekday') {
    const weekday = intInRange(raw.weekday, 0, 6);
    const week = raw.week === -1 || raw.week === '-1' ? -1 : intInRange(raw.week, 1, 4);
    if (weekday === null || week === null) return null;
    return { freq: 'yearly', mode: 'weekday', month, week, weekday, startYear, endYear };
  }

  const day = intInRange(raw.day, 1, 31);
  if (day === null) return null;
  return { freq: 'yearly', mode: 'date', month, day, startYear, endYear };
}

/**
 * The occurrence start DAY (local midnight) in a given year, or null if the
 * rule doesn't reach that year. Feb 29 in a common year clamps to Feb 28 so a
 * leap-day event still shows up every year.
 */
export function occurrenceDayForYear(rule, year) {
  const r = normalizeRecurrence(rule);
  if (!r) return null;
  if (r.startYear !== null && year < r.startYear) return null;
  if (r.endYear !== null && year > r.endYear) return null;
  const monthIndex = r.month - 1;
  if (r.mode === 'weekday') return nthWeekday(year, monthIndex, r.weekday, r.week);
  return new Date(year, monthIndex, Math.min(r.day, daysInMonth(year, monthIndex)));
}

/**
 * Time of day and length pulled off the anchor dates, so every occurrence
 * repeats the same shape. Length is carried as whole days plus an end time
 * rather than a millisecond span, which keeps a 3-day event 3 days long even
 * across a daylight-saving change.
 */
function anchorShape(event) {
  const start = toDate(event?.date);
  if (!start) return null;
  const rawEnd = toDate(event?.endDate);
  let spanDays = 0;
  let endHours = start.getHours();
  let endMinutes = start.getMinutes();
  if (rawEnd) {
    const diff = Math.round((startOfDay(rawEnd) - startOfDay(start)) / 86400000);
    if (diff >= 0 && diff <= MAX_SPAN_DAYS) {
      spanDays = diff;
      endHours = rawEnd.getHours();
      endMinutes = rawEnd.getMinutes();
    }
  }
  return {
    hours: start.getHours(),
    minutes: start.getMinutes(),
    spanDays,
    endHours,
    endMinutes,
    hasEnd: !!rawEnd && spanDays >= 0,
  };
}

/** The concrete {start, end} for one year of a series, or null. */
export function occurrenceForYear(event, year) {
  const rule = normalizeRecurrence(event?.recurrence);
  if (!rule) return null;
  const shape = anchorShape(event);
  if (!shape) return null;
  const day = occurrenceDayForYear(rule, year);
  if (!day) return null;
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), shape.hours, shape.minutes);
  const endDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + shape.spanDays);
  const end = new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate(), shape.endHours, shape.endMinutes);
  return { year, start, end, hasEnd: shape.hasEnd };
}

/**
 * Every occurrence overlapping [rangeStart, rangeEnd], oldest first. The
 * neighbouring years are probed too so a multi-day event that starts in
 * December still shows on a January grid.
 */
export function occurrencesInRange(event, rangeStart, rangeEnd) {
  if (!isRecurring(event) || !rangeStart || !rangeEnd) return [];
  const out = [];
  for (let year = rangeStart.getFullYear() - 1; year <= rangeEnd.getFullYear() + 1; year++) {
    const occ = occurrenceForYear(event, year);
    if (!occ) continue;
    if (occ.end < rangeStart || occ.start > rangeEnd) continue;
    out.push(occ);
  }
  return out;
}

/**
 * The occurrence that is happening now or coming next, relative to `from`.
 * An occurrence counts as current until its LAST day is over, so a multi-day
 * event doesn't jump to next year while it's still running. Returns null once
 * the series has ended.
 */
export function nextOccurrence(event, from = new Date()) {
  if (!isRecurring(event)) return null;
  const today = startOfDay(from);
  const rule = normalizeRecurrence(event.recurrence);
  const lastYear = rule.endYear !== null ? rule.endYear : from.getFullYear() + 1;
  for (let year = from.getFullYear() - 1; year <= lastYear; year++) {
    const occ = occurrenceForYear(event, year);
    if (!occ) continue;
    if (startOfDay(occ.end) >= today) return occ;
  }
  return null;
}

/**
 * The occurrence to treat as "the" event right now: the current/next one, or —
 * for a series that has already ended — its final occurrence, so a finished
 * series reads as a past event instead of jumping back to the anchor year.
 */
export function activeOccurrence(event, from = new Date()) {
  const upcoming = nextOccurrence(event, from);
  if (upcoming) return upcoming;
  const rule = normalizeRecurrence(event?.recurrence);
  if (!rule || rule.endYear === null) return null;
  return occurrenceForYear(event, rule.endYear);
}

/** "Every year on July 4" / "Every year on the third Saturday of September". */
export function describeRecurrence(rule) {
  const r = normalizeRecurrence(rule);
  if (!r) return '';
  const month = MONTH_NAMES[r.month - 1];
  const base = r.mode === 'weekday'
    ? `Every year on the ${(WEEK_ORDINALS.find(o => o.value === r.week) || {}).label} ${WEEKDAY_NAMES[r.weekday]} of ${month}`
    : `Every year on ${month} ${r.day}`;
  return r.endYear !== null ? `${base}, through ${r.endYear}` : base;
}

/** Short form for chips and cards: "Jul 4" / "3rd Sat of Sep". */
export function shortRecurrenceLabel(rule) {
  const r = normalizeRecurrence(rule);
  if (!r) return '';
  const month = MONTH_NAMES[r.month - 1].slice(0, 3);
  if (r.mode === 'date') return `${month} ${r.day}`;
  const ordinal = r.week === -1 ? 'last' : ['1st', '2nd', '3rd', '4th'][r.week - 1];
  return `${ordinal} ${WEEKDAY_NAMES[r.weekday].slice(0, 3)} of ${month}`;
}

/**
 * A rule that lands on the given date, used to seed the picker when someone
 * first turns repeating on. 'weekday' mode reads the date's position in its
 * month (a date in the last 7 days of the month becomes "last <weekday>").
 */
export function recurrenceFromDate(date, mode = 'date') {
  const d = toDate(date) || new Date();
  const month = d.getMonth() + 1;
  const startYear = d.getFullYear();
  if (mode === 'weekday') {
    const weekOfMonth = Math.ceil(d.getDate() / 7);
    const isLast = d.getDate() + 7 > daysInMonth(d.getFullYear(), d.getMonth());
    return {
      freq: 'yearly',
      mode: 'weekday',
      month,
      week: isLast || weekOfMonth > 4 ? -1 : weekOfMonth,
      weekday: d.getDay(),
      startYear,
      endYear: null,
    };
  }
  return { freq: 'yearly', mode: 'date', month, day: d.getDate(), startYear, endYear: null };
}
