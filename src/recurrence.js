// Recurring events.
//
// A series is an ordinary event that also carries a `recurrence` rule. Every
// occurrence is materialized as its own event document — its own RSVP list,
// chat, itinerary and travel planning — so nothing downstream needs to know
// recurrence exists to render it. This file is the pure part: the rule shape,
// the dates a rule produces, and how to describe one in English.
//
// Rule shape (all fields optional except `freq`, filled in by normalizeRecurrence):
//   freq:     'yearly' | 'monthly' | 'weekly'
//   mode:     'date' | 'nth'   — yearly/monthly: a fixed day, or the Nth weekday
//   month:    0-11             — yearly only
//   day:      1-31             — mode 'date'
//   weekday:  0-6 (Sun-Sat)    — mode 'nth'
//   week:     1-5, or -1 for last — mode 'nth'
//   weekdays: [0-6]            — weekly only
//   until:    'YYYY-MM-DD'     — optional last day of the series

export const FREQUENCIES = ['yearly', 'monthly', 'weekly'];

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// -1 is "last", which is what you want for things like the last Monday of May.
export const WEEK_OPTIONS = [
  { value: 1, label: 'first' },
  { value: 2, label: 'second' },
  { value: 3, label: 'third' },
  { value: 4, label: 'fourth' },
  { value: 5, label: 'fifth' },
  { value: -1, label: 'last' },
];

// How many dates of a series are kept on the calendar at any time — including
// the series' own date while it's still ahead, since that's a real event too.
// Every occurrence is a document, so these trade how far out a series is
// visible against how many documents it costs. The window rolls forward as time
// passes (see useRecurringEvents); it isn't a cap on the length of the series.
export const LOOKAHEAD = { yearly: 3, monthly: 6, weekly: 8 };

export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function parseYMD(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d) ? null : d;
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();

// The nth `weekday` of a month, or null when the month doesn't have one (not
// every month has a fifth Thursday). n is 1-based, or -1 for the last.
export function nthWeekdayOfMonth(year, month, weekday, n) {
  if (n === -1) {
    const last = new Date(year, month + 1, 0);
    return new Date(year, month, last.getDate() - ((last.getDay() - weekday + 7) % 7));
  }
  const first = new Date(year, month, 1);
  const day = 1 + ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7;
  return day > daysInMonth(year, month) ? null : new Date(year, month, day);
}

const clampInt = (v, min, max, fallback) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

// Fill in a stored rule's blanks and reject anything unusable, so every reader
// downstream can trust the shape. Returns null for "this doesn't repeat".
export function normalizeRecurrence(raw) {
  if (!raw || !FREQUENCIES.includes(raw.freq)) return null;
  const until = parseYMD(raw.until) ? raw.until : '';
  if (raw.freq === 'weekly') {
    const weekdays = [...new Set((Array.isArray(raw.weekdays) ? raw.weekdays : [])
      .map((d) => clampInt(d, 0, 6, null))
      .filter((d) => d != null))].sort((a, b) => a - b);
    if (weekdays.length === 0) return null; // a weekly rule with no days never fires
    return { freq: 'weekly', weekdays, until };
  }
  const mode = raw.mode === 'nth' ? 'nth' : 'date';
  const rule = { freq: raw.freq, mode, until };
  if (raw.freq === 'yearly') rule.month = clampInt(raw.month, 0, 11, 0);
  if (mode === 'nth') {
    rule.weekday = clampInt(raw.weekday, 0, 6, 0);
    rule.week = raw.week === -1 || raw.week === '-1' ? -1 : clampInt(raw.week, 1, 5, 1);
  } else {
    rule.day = clampInt(raw.day, 1, 31, 1);
  }
  return rule;
}

// The date a yearly/monthly rule lands on in one specific month, or null when
// that month can't host it (no 31st, no fifth Friday).
function occurrenceInMonth(rule, year, month) {
  if (rule.mode === 'nth') return nthWeekdayOfMonth(year, month, rule.weekday, rule.week);
  return rule.day > daysInMonth(year, month) ? null : new Date(year, month, rule.day);
}

// The next `max` occurrence dates strictly after `after`, stopping at the
// rule's end date. Dates come back local and date-only; the time of day is the
// series start's business, not the rule's.
export function occurrencesAfter(rule, after, max) {
  const r = normalizeRecurrence(rule);
  if (!r || !after || isNaN(after) || max <= 0) return [];
  const from = startOfDay(after);
  const limit = r.until ? parseYMD(r.until) : null;
  const out = [];

  if (r.freq === 'weekly') {
    const d = new Date(from);
    d.setDate(d.getDate() + 1);
    // Two years of days is a generous ceiling: any weekly rule fills `max` long
    // before that, and it keeps a bad rule from spinning.
    for (let i = 0; i < 732 && out.length < max; i++) {
      if (r.weekdays.includes(d.getDay())) {
        if (limit && d > limit) break;
        out.push(new Date(d));
      }
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  let year = from.getFullYear();
  let month = r.freq === 'yearly' ? r.month : from.getMonth();
  // Months that can't host the rule are skipped, so the bound is on periods
  // tried rather than dates produced.
  for (let i = 0; i < 400 && out.length < max; i++) {
    const d = occurrenceInMonth(r, year, month);
    if (d && d > from) {
      if (limit && d > limit) break;
      out.push(d);
    }
    if (r.freq === 'yearly') {
      year++;
    } else if (++month > 11) {
      month = 0;
      year++;
    }
  }
  return out;
}

const ordinal = (n) => {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
};

const weekLabel = (week) => WEEK_OPTIONS.find((w) => w.value === week)?.label || 'first';

// "Every year on the fourth Thursday of November", and friends. Used for the
// badge on the event and the live preview under the form's repeat controls.
export function describeRecurrence(raw) {
  const r = normalizeRecurrence(raw);
  if (!r) return '';
  let text;
  if (r.freq === 'weekly') {
    const names = r.weekdays.map((d) => WEEKDAY_SHORT[d]);
    const days = names.length === 1
      ? WEEKDAY_NAMES[r.weekdays[0]]
      : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
    text = `Every week on ${days}`;
  } else if (r.freq === 'monthly') {
    text = r.mode === 'nth'
      ? `Every month on the ${weekLabel(r.week)} ${WEEKDAY_NAMES[r.weekday]}`
      : `Every month on the ${ordinal(r.day)}`;
  } else {
    text = r.mode === 'nth'
      ? `Every year on the ${weekLabel(r.week)} ${WEEKDAY_NAMES[r.weekday]} of ${MONTH_NAMES[r.month]}`
      : `Every year on ${MONTH_NAMES[r.month]} ${r.day}`;
  }
  const end = r.until ? parseYMD(r.until) : null;
  if (end) text += `, until ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  return text;
}

// Seed the rule controls off the start date the user already picked, so
// choosing "every year" means "every year on this date" without more clicks.
export function defaultRuleFromDate(date, freq) {
  const d = date && !isNaN(date) ? date : new Date();
  return {
    freq,
    mode: 'date',
    month: d.getMonth(),
    day: d.getDate(),
    weekday: d.getDay(),
    // Which "nth weekday" this date is: the 15th is in the third week of days.
    week: Math.min(Math.ceil(d.getDate() / 7), 5),
    weekdays: [d.getDay()],
    until: '',
  };
}

// Occurrence documents get a derived id rather than a random one: two devices
// filling the same gap at the same time write the same document instead of two.
export const occurrenceDocId = (seriesId, date) => `${seriesId}__${ymd(date)}`;

// Event dates arrive as Firestore Timestamps, and as plain strings in older or
// cached documents. Both land here as a Date, or null when unusable.
export function toEventDate(v) {
  if (!v) return null;
  const d = v.toDate ? v.toDate() : new Date(v);
  return isNaN(d) ? null : d;
}

// Which dates of a series still need an event document. Pure, and kept beside
// the rule engine rather than in the hook that writes, because the two rules
// that make it safe to run on every app load are the whole design: never
// backfill an occurrence that was deleted, and never duplicate the series'
// own date.
export function missingOccurrenceDates(series, { now = new Date(), existingIds = new Set() } = {}) {
  const rule = normalizeRecurrence(series?.recurrence);
  if (!rule) return [];
  const start = toEventDate(series.date);
  if (!start) return [];
  // Yesterday, so an occurrence landing today still counts as upcoming.
  const from = new Date(now);
  from.setDate(from.getDate() - 1);
  // How far ahead this series has ever been filled. Everything at or before it
  // has had its chance to exist, so anything missing there was deleted on
  // purpose and is left alone.
  const generatedThrough = series.recurrenceGeneratedThrough || '';
  const startYmd = ymd(start);
  return occurrencesAfter(rule, from, LOOKAHEAD[rule.freq] || 3).filter((d) => {
    const key = ymd(d);
    if (key === startYmd) return false;
    if (key <= generatedThrough) return false;
    return !existingIds.has(occurrenceDocId(series.id, d));
  });
}
