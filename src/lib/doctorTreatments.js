/* Treatments on the Doctors page: a course of something with a beginning and
 * an end, laid out across the months it covers.
 *
 * A record answers "who did I see for this?"; a treatment answers "what am I
 * on, and until when?" — the six weeks of physio, the two years of Invisalign,
 * the statin with no end in sight. Written down as a note it tells you nothing
 * about November; on a row of months you can see what overlaps what, and which
 * side of the finish line you are on.
 *
 * The ends are dates — `YYYY-MM-DD` — because a course of antibiotics or a
 * cast has a day it starts and a day it comes off, and "March" doesn't say
 * whether you're still in it on the 20th. Month keys — `YYYY-MM` — still
 * read, since that is how the tab first stored them: a month-only start means
 * the 1st and a month-only end the last day. An empty end means it is still
 * going. The grid stays a row of months; a bar just starts and stops part of
 * the way across the month a day falls in.
 */

const pad2 = (n) => String(n).padStart(2, '0');

export const monthKey = (year, monthIndex) => `${year}-${pad2(monthIndex + 1)}`;

/** `YYYY-MM` → { year, month } (month 0-11), or null for anything else. */
export function parseMonth(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  if (month < 0 || month > 11) return null;
  return { year, month };
}

/** `YYYY-MM-DD` or `YYYY-MM` → { year, month, day } (day null for a bare
 *  month), or null for anything else, including a day the month hasn't got. */
export function parseWhen(key) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(key || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  if (month < 0 || month > 11) return null;
  if (m[3] == null) return { year, month, day: null };
  const day = Number(m[3]);
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();

export const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Both formats sort as strings once a bare month is widened to the day it
// stands for at that end: the 1st as a start, the last day as an end.
const isWhen = (key) => !!parseWhen(key);
export function firstDay(key) {
  const p = parseWhen(key);
  if (!p) return '';
  return p.day ? String(key).trim() : `${monthKey(p.year, p.month)}-01`;
}
export function lastDay(key) {
  const p = parseWhen(key);
  if (!p) return '';
  return p.day ? String(key).trim() : `${monthKey(p.year, p.month)}-${pad2(daysInMonth(p.year, p.month))}`;
}
const monthOf = (key) => String(key).trim().slice(0, 7);

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const thisMonthKey = (today = new Date()) => monthKey(today.getFullYear(), today.getMonth());

let seq = 0;
const makeId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

/* One treatment, repaired.
 *
 * A range typed backwards is swapped rather than dropped: "Mar 2027 to Jan
 * 2027" is a fat-fingered pair of pickers, and the honest reading of it is
 * the days between them. A start that isn't a date at all leaves the
 * treatment unplaced — it still lists, it just has no bar to draw.
 *
 * `notStarted` is a course you have been given but haven't begun: the
 * physio referral you haven't booked, the prescription still in the bag.
 * Its dates, if it has any, are the plan rather than what happened, so it
 * says "not started" whatever today is until you take the flag off.
 */
export function normalizeTreatment(raw) {
  const str = (v) => String(v ?? '').trim();
  let start = isWhen(raw?.start) ? str(raw.start) : '';
  let end = isWhen(raw?.end) ? str(raw.end) : '';
  if (start && end && lastDay(end) < firstDay(start)) [start, end] = [end, start];
  return {
    id: str(raw?.id) || makeId(),
    name: str(raw?.name),
    type: str(raw?.type),
    doctor: str(raw?.doctor),
    start,
    end,
    notes: str(raw?.notes),
    notStarted: raw?.notStarted === true,
  };
}

// Soonest first, and from the same day the one that ends first — a short
// course reads as a short course when it sits above an open-ended one.
const byWhen = (a, b) => (firstDay(a.start) || '9999').localeCompare(firstDay(b.start) || '9999')
  || (lastDay(a.end) || '9999-99').localeCompare(lastDay(b.end) || '9999-99')
  || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export function normalizeTreatments(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map(normalizeTreatment)
    .filter((t) => t.name || t.start)
    .sort(byWhen);
}

/** Whether a treatment is running in the given month key. */
export function coversMonth(treatment, key) {
  const t = normalizeTreatment(treatment);
  if (!t.start || !parseMonth(key)) return false;
  if (key < monthOf(t.start)) return false;
  return !t.end || key <= monthOf(t.end);
}

/* How much of a month's cell a treatment's bar fills, as fractions from the
 * left: { from, to }, or null when it isn't running that month. A month in
 * the middle of a course is 0 → 1; the month it starts on the 15th begins
 * about halfway across. A bare-month end fills its month, as it always did. */
export function monthCoverage(treatment, key) {
  if (!coversMonth(treatment, key)) return null;
  const t = normalizeTreatment(treatment);
  const { year, month } = parseMonth(key);
  const dim = daysInMonth(year, month);
  const s = parseWhen(t.start);
  const e = parseWhen(t.end);
  const from = monthOf(t.start) === key && s.day ? (s.day - 1) / dim : 0;
  const to = e && monthOf(t.end) === key && e.day ? e.day / dim : 1;
  return { from, to };
}

export const isOngoing = (t) => !!t?.start && !t?.end && !t?.notStarted;

/* The years the grid draws.
 *
 * Everything the treatments touch, and this year whatever they touch, so the
 * page always has a column for the month you are standing in. An open-ended
 * course runs to the end of the range rather than off the edge of it, so the
 * last year shown is the latest of: this year, the latest end, and the latest
 * start (a course starting next spring is worth seeing before it begins).
 */
export function gridYears(treatments, today = new Date()) {
  const now = today.getFullYear();
  const years = [];
  for (const raw of treatments || []) {
    const t = normalizeTreatment(raw);
    const s = parseWhen(t.start);
    const e = parseWhen(t.end);
    if (s) years.push(s.year);
    if (e) years.push(e.year);
  }
  const from = Math.min(now, ...years);
  const to = Math.max(now, ...years);
  const out = [];
  for (let y = from; y <= to; y++) out.push(y);
  return out;
}

/* How a treatment reads in words: "Mar 14, 2027 – Jun 2, 2027",
 * "From Mar 14, 2027" — or "Mar 2027" for one stored as a bare month. */
export function whenLabel(key) {
  const p = parseWhen(key);
  if (!p) return '';
  return p.day ? `${MONTHS_SHORT[p.month]} ${p.day}, ${p.year}` : `${MONTHS_SHORT[p.month]} ${p.year}`;
}

export function describeSpan(treatment) {
  const t = normalizeTreatment(treatment);
  const label = whenLabel;
  if (!t.start) return 'No dates yet';
  if (!t.end) return `From ${label(t.start)}`;
  if (t.start === t.end) return label(t.start);
  return `${label(t.start)} – ${label(t.end)}`;
}

/* Where a treatment sits against today: done, running, or still to come —
 * or not started, which is your say rather than the calendar's.
 * What the row's colour says before you count columns. To the day: a course
 * that ended yesterday is finished, even with the month not out. */
export function treatmentState(treatment, today = new Date()) {
  const t = normalizeTreatment(treatment);
  const now = dateKey(today);
  if (t.notStarted) return 'notstarted';
  if (!t.start) return 'unplaced';
  if (firstDay(t.start) > now) return 'upcoming';
  if (!t.end || lastDay(t.end) >= now) return 'current';
  return 'past';
}

// --- counting ----------------------------------------------------------------
// How long a course runs, in days and in months. Both ends count: the 1st to
// the 3rd is three days on it. A month is a calendar month — the 16th to the
// 15th — so "2 months" means what it says rather than 60 days.

const toDate = (key) => {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d);
};
// Local midnight to local midnight, rounded, so a clock change in the middle
// doesn't lose an hour and with it a day.
const daysBetween = (a, b) => Math.round((b - a) / 86400000);

// The date `n` calendar months after `d`, held to the month's last day when
// the day doesn't exist there (Jan 31 + 1 month is Feb 28, not Mar 3).
function addMonths(d, n) {
  const y = d.getFullYear();
  const m = d.getMonth() + n;
  const day = Math.min(d.getDate(), daysInMonth(y + Math.floor(m / 12), ((m % 12) + 12) % 12));
  return new Date(y, m, day);
}

/** The whole months and leftover days from `from` up to (not including) `to`,
 *  both `YYYY-MM-DD`. */
export function monthsAndDays(from, to) {
  const a = toDate(from);
  const b = toDate(to);
  if (!(b > a)) return { months: 0, days: 0 };
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (addMonths(a, months) > b) months -= 1;
  return { months, days: daysBetween(addMonths(a, months), b) };
}

const nextDay = (key) => { const d = toDate(key); d.setDate(d.getDate() + 1); return dateKey(d); };

/* The counts behind a treatment's counter, all inclusive of both ends:
 *   total    — days it runs, start to end (null when it has no end)
 *   elapsed  — days on it so far, today included (null before it starts)
 *   left     — days still to go after today (null with no end, or once done)
 *   until    — days until it starts (null once it has)
 * and the same spans as { months, days } for the ones worth saying in months. */
export function treatmentCounts(treatment, today = new Date()) {
  const t = normalizeTreatment(treatment);
  if (!t.start) return null;
  const start = firstDay(t.start);
  const end = t.end ? lastDay(t.end) : '';
  const now = dateKey(today);
  const total = end ? daysBetween(toDate(start), toDate(end)) + 1 : null;
  const begun = now >= start;
  const stopAt = end && end < now ? end : now;
  return {
    state: treatmentState(t, today),
    total,
    totalSpan: end ? monthsAndDays(start, nextDay(end)) : null,
    elapsed: begun ? daysBetween(toDate(start), toDate(stopAt)) + 1 : null,
    elapsedSpan: begun ? monthsAndDays(start, nextDay(stopAt)) : null,
    left: end && begun && end >= now ? daysBetween(toDate(now), toDate(end)) : null,
    until: begun ? null : daysBetween(toDate(now), toDate(start)),
  };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dayCount = (n) => plural(n, 'day');

/** "2 months 3 days", "1 month", "12 days". */
export function formatSpan({ months, days }) {
  if (!months) return dayCount(days);
  return days ? `${plural(months, 'month')} ${dayCount(days)}` : plural(months, 'month');
}

// A span of under a month says nothing the day count hasn't.
const withMonths = (n, span) => (span?.months ? `${dayCount(n)} (${formatSpan(span)})` : dayCount(n));

/* The counter, in words, for where the course stands today:
 *   running, with an end   "Day 8 of 61 · 54 days left"
 *   running, open-ended    "Day 45 (1 month 14 days)"
 *   still to come          "Starts in 12 days · 61 days (2 months)"
 *   finished               "61 days (2 months)"
 *   not started            "Not started · due in 8 days · planned 31 days (1 month)",
 *                          "Not started · 5 days overdue", or just "Not started" */
export function describeCounter(treatment, today = new Date()) {
  const t = normalizeTreatment(treatment);
  if (t.notStarted) {
    const parts = ['Not started'];
    if (t.start) {
      const due = daysBetween(toDate(dateKey(today)), toDate(firstDay(t.start)));
      if (due > 1) parts.push(`due in ${dayCount(due)}`);
      else if (due === 1) parts.push('due tomorrow');
      else if (due === 0) parts.push('due today');
      else parts.push(`${dayCount(-due)} overdue`);
    }
    if (t.start && t.end) parts.push(`planned ${describeLength(t.start, t.end)}`);
    return parts.join(' · ');
  }
  const c = treatmentCounts(t, today);
  if (!c) return '';
  if (c.state === 'upcoming') {
    const starts = c.until === 1 ? 'Starts tomorrow' : `Starts in ${dayCount(c.until)}`;
    return c.total ? `${starts} · ${withMonths(c.total, c.totalSpan)}` : starts;
  }
  if (c.state === 'past') return withMonths(c.total, c.totalSpan);
  if (c.total == null) {
    return c.elapsedSpan.months ? `Day ${c.elapsed} (${formatSpan(c.elapsedSpan)})` : `Day ${c.elapsed}`;
  }
  const left = c.left === 0 ? 'last day' : `${dayCount(c.left)} left`;
  return `Day ${c.elapsed} of ${c.total} · ${left}`;
}

/* The length of a start and end as typed, for the form: "61 days (2 months)",
 * or '' until both ends are there. */
export function describeLength(start, end) {
  const t = normalizeTreatment({ start, end });
  if (!t.start || !t.end) return '';
  const from = firstDay(t.start);
  const to = lastDay(t.end);
  return withMonths(daysBetween(toDate(from), toDate(to)) + 1, monthsAndDays(from, nextDay(to)));
}

// --- editing ---------------------------------------------------------------
// The same shape as the rest of this page's editors: take the document, hand
// back a new one, and let the caller write it.

export function addTreatment(list, treatment) {
  const t = normalizeTreatment({ ...treatment, id: treatment?.id || makeId() });
  return { ...list, treatments: normalizeTreatments([...(list?.treatments || []), t]) };
}

export function updateTreatment(list, id, patch) {
  return {
    ...list,
    treatments: normalizeTreatments((list?.treatments || [])
      .map((t) => (t.id === id ? { ...t, ...patch, id } : t))),
  };
}

export function removeTreatment(list, id) {
  return { ...list, treatments: (list?.treatments || []).filter((t) => t.id !== id) };
}
