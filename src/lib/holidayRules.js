/* Holiday cadences.

   A holiday is { id, name, rule, ... } and the rule says when it falls. Every
   date on the Holidays page and on the calendars is computed from the rule, so
   nothing is tied to one year.

   A rule is built in four steps, applied in this order:

     1. the base date(s)        — `kind` and its fields (below)
     2. `adjust`                — nudge it (off a weekend, or onto a weekday)
     3. `offsetDays`            — shift by whole days (negative = earlier)
     4. `durationDays`          — how many days it runs from there

   and filtered by `everyYears`/`anchorYear` (every N years), `startDate` and
   `endDate`.

   Kinds:
     date      { months: [1-12…] | [] for every month, day: 1-31 | -1 (last day) }
     weekday   { months, weekday: 0-6 (Sun-Sat), nth: 1-5 | -1 (last) }
     interval  { anchor: 'YYYY-MM-DD', every: N, unit: 'day'|'week'|'month'|'year' }
     easter    { }                       Western Easter Sunday
     relative  { baseId }                wherever another holiday falls
     once      { date: 'YYYY-MM-DD' }

   Everything here is pure and works on local-time 'YYYY-MM-DD' strings. */

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const RULE_KINDS = ['date', 'weekday', 'interval', 'relative', 'easter', 'once'];
export const INTERVAL_UNITS = ['day', 'week', 'month', 'year'];
export const ADJUST_TYPES = ['none', 'nearestWeekday', 'nextMonday', 'previousFriday', 'weekdayOnOrAfter', 'weekdayOnOrBefore', 'weekdayNearest'];

const MAX_DURATION = 60;
const MAX_OFFSET = 366;
// A cap on what one holiday can produce for one range, so a daily cadence asked
// for a decade cannot lock the page up.
const MAX_OCCURRENCES = 800;

const pad = (n) => String(n).padStart(2, '0');
export const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseIso(iso) {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  // Reject overflow (Feb 30 → Mar 2) rather than silently moving the date.
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

const daysInMonth = (year, month1) => new Date(year, month1, 0).getDate();

// Whole days from a to b. Rounded because a DST change makes a day 23 or 25 hours.
const dayDiff = (a, b) => Math.round((b - a) / 86400000);

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Western (Gregorian) Easter Sunday — the anonymous Gregorian algorithm.
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// Fills in every field with a valid value, so the rest of the module (and the
// form) never has to second-guess a rule that came out of storage.
export function normalizeRule(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const kind = RULE_KINDS.includes(r.kind) ? r.kind : 'date';
  const months = [...new Set((Array.isArray(r.months) ? r.months : [])
    .map(Number).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort((a, b) => a - b);
  const day = Number(r.day) === -1 ? -1 : clampInt(r.day, 1, 31, 1);
  const nth = Number(r.nth) === -1 ? -1 : clampInt(r.nth, 1, 5, 1);
  const adj = r.adjust && typeof r.adjust === 'object' ? r.adjust : {};
  const everyYears = clampInt(r.everyYears, 1, 100, 1);
  return {
    kind,
    months,
    day,
    weekday: clampInt(r.weekday, 0, 6, 1),
    nth,
    anchor: parseIso(r.anchor) ? r.anchor : '',
    every: clampInt(r.every, 1, 1000, 1),
    unit: INTERVAL_UNITS.includes(r.unit) ? r.unit : 'week',
    baseId: typeof r.baseId === 'string' ? r.baseId : '',
    date: parseIso(r.date) ? r.date : '',
    adjust: {
      type: ADJUST_TYPES.includes(adj.type) ? adj.type : 'none',
      weekday: clampInt(adj.weekday, 0, 6, 1),
    },
    offsetDays: clampInt(r.offsetDays, -MAX_OFFSET, MAX_OFFSET, 0),
    durationDays: clampInt(r.durationDays, 1, MAX_DURATION, 1),
    everyYears,
    anchorYear: everyYears > 1 ? clampInt(r.anchorYear, 1900, 2200, 2024) : null,
    startDate: parseIso(r.startDate) ? r.startDate : '',
    endDate: parseIso(r.endDate) ? r.endDate : '',
  };
}

// Why a rule cannot produce a date yet, or '' when it can. Shown under the form.
export function ruleProblem(raw, holidays = [], selfId = null) {
  const r = normalizeRule(raw);
  if (r.kind === 'once' && !r.date) return 'Pick the date.';
  if (r.kind === 'interval' && !r.anchor) return 'Pick the date it starts counting from.';
  if (r.kind === 'relative') {
    if (!r.baseId) return 'Pick the holiday it follows.';
    if (!holidays.some((h) => h.id === r.baseId)) return 'The holiday it follows no longer exists.';
    if (selfId && dependsOn(r.baseId, selfId, holidays)) return 'That holiday already depends on this one.';
  }
  if (r.startDate && r.endDate && r.endDate < r.startDate) return 'It ends before it starts.';
  return '';
}

// Does holiday `id` (through any chain of relative rules) rest on `targetId`?
function dependsOn(id, targetId, holidays, seen = new Set()) {
  if (id === targetId) return true;
  if (seen.has(id)) return false;
  seen.add(id);
  const h = holidays.find((x) => x.id === id);
  if (!h || h.rule?.kind !== 'relative') return false;
  return dependsOn(h.rule.baseId, targetId, holidays, seen);
}

function applyAdjust(d, adjust) {
  const dow = d.getDay();
  switch (adjust.type) {
    case 'nearestWeekday':
      return dow === 6 ? addDays(d, -1) : dow === 0 ? addDays(d, 1) : d;
    case 'nextMonday':
      return dow === 6 ? addDays(d, 2) : dow === 0 ? addDays(d, 1) : d;
    case 'previousFriday':
      return dow === 6 ? addDays(d, -1) : dow === 0 ? addDays(d, -2) : d;
    case 'weekdayOnOrAfter':
      return addDays(d, (adjust.weekday - dow + 7) % 7);
    case 'weekdayOnOrBefore':
      return addDays(d, -((dow - adjust.weekday + 7) % 7));
    case 'weekdayNearest': {
      const fwd = (adjust.weekday - dow + 7) % 7;
      return fwd <= 3 ? addDays(d, fwd) : addDays(d, fwd - 7);
    }
    default:
      return d;
  }
}

// Base dates (step 1) falling between two Date bounds, before adjust/offset.
function baseDates(rule, from, to, ctx) {
  const out = [];
  const y0 = from.getFullYear();
  const y1 = to.getFullYear();
  const months = rule.months.length ? rule.months : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  if (rule.kind === 'once') {
    const d = parseIso(rule.date);
    if (d) out.push(d);
  } else if (rule.kind === 'date') {
    for (let y = y0; y <= y1; y++) {
      for (const m of months) {
        const dim = daysInMonth(y, m);
        const day = rule.day === -1 ? dim : rule.day;
        // The 31st of a 30-day month, or Feb 29 off a leap year: no occurrence.
        if (day <= dim) out.push(new Date(y, m - 1, day));
      }
    }
  } else if (rule.kind === 'weekday') {
    for (let y = y0; y <= y1; y++) {
      for (const m of months) {
        const dim = daysInMonth(y, m);
        let day;
        if (rule.nth === -1) {
          const last = new Date(y, m - 1, dim);
          day = dim - ((last.getDay() - rule.weekday + 7) % 7);
        } else {
          const first = new Date(y, m - 1, 1);
          day = 1 + ((rule.weekday - first.getDay() + 7) % 7) + (rule.nth - 1) * 7;
        }
        // A month with only four Fridays has no fifth one.
        if (day <= dim) out.push(new Date(y, m - 1, day));
      }
    }
  } else if (rule.kind === 'easter') {
    for (let y = y0; y <= y1; y++) out.push(easterSunday(y));
  } else if (rule.kind === 'interval') {
    const anchor = parseIso(rule.anchor);
    if (!anchor) return out;
    if (rule.unit === 'day' || rule.unit === 'week') {
      const step = rule.every * (rule.unit === 'week' ? 7 : 1);
      // Jump straight to the first step at or after `from` instead of walking
      // there from the anchor.
      const k0 = Math.max(0, Math.ceil(dayDiff(anchor, from) / step));
      for (let k = k0; out.length < MAX_OCCURRENCES; k++) {
        const d = addDays(anchor, k * step);
        if (d > to) break;
        out.push(d);
      }
    } else {
      const stepMonths = rule.every * (rule.unit === 'year' ? 12 : 1);
      const monthsToFrom = (from.getFullYear() - anchor.getFullYear()) * 12 + (from.getMonth() - anchor.getMonth());
      const k0 = Math.max(0, Math.floor(monthsToFrom / stepMonths) - 1);
      for (let k = k0; out.length < MAX_OCCURRENCES; k++) {
        const first = new Date(anchor.getFullYear(), anchor.getMonth() + k * stepMonths, 1);
        if (first > to) break;
        const dim = daysInMonth(first.getFullYear(), first.getMonth() + 1);
        // Anchored on the 31st (or Feb 29): land on the month's last day rather
        // than skipping, so "every month from Jan 31" still means monthly.
        out.push(new Date(first.getFullYear(), first.getMonth(), Math.min(anchor.getDate(), dim)));
      }
    }
  } else if (rule.kind === 'relative') {
    const base = ctx.holidays.find((h) => h.id === rule.baseId);
    if (!base || ctx.stack.includes(base.id)) return out;
    const occ = occurrencesBetween(base, from, to, { holidays: ctx.holidays, stack: [...ctx.stack, base.id] });
    for (const o of occ) out.push(parseIso(o.start));
  }
  return out;
}

function occurrencesBetween(holiday, from, to, ctx) {
  const rule = normalizeRule(holiday?.rule);
  // Widen the search so an occurrence shifted or stretched into the range from
  // just outside it is still found.
  const margin = Math.abs(rule.offsetDays) + rule.durationDays + 8;
  const bases = baseDates(rule, addDays(from, -margin), addDays(to, margin), ctx);
  const start = parseIso(rule.startDate);
  const end = parseIso(rule.endDate);
  const seen = new Set();
  const out = [];
  for (const base of bases) {
    if (rule.everyYears > 1 && rule.kind !== 'once' && rule.kind !== 'interval') {
      const delta = base.getFullYear() - rule.anchorYear;
      if (((delta % rule.everyYears) + rule.everyYears) % rule.everyYears !== 0) continue;
    }
    const first = addDays(applyAdjust(base, rule.adjust), rule.offsetDays);
    const last = addDays(first, rule.durationDays - 1);
    if (last < from || first > to) continue;
    if (start && first < start) continue;
    if (end && first > end) continue;
    const key = toIso(first);
    if (seen.has(key)) continue;
    seen.add(key);
    const dates = [];
    for (let i = 0; i < rule.durationDays; i++) dates.push(toIso(addDays(first, i)));
    out.push({ start: key, end: toIso(last), dates });
    if (out.length >= MAX_OCCURRENCES) break;
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// Every occurrence of `holiday` touching [fromIso, toIso], soonest first:
// [{ start, end, dates: [...] }]. `holidays` is the full list, needed only so a
// "relative" rule can find the holiday it follows.
export function occurrencesInRange(holiday, fromIso, toIsoStr, holidays = []) {
  const from = parseIso(fromIso);
  const to = parseIso(toIsoStr);
  if (!from || !to || to < from) return [];
  return occurrencesBetween(holiday, from, to, { holidays, stack: [holiday?.id] });
}

export function occurrencesForYear(holiday, year, holidays = []) {
  return occurrencesInRange(holiday, `${year}-01-01`, `${year}-12-31`, holidays)
    // A span that began last December belongs to last year's list.
    .filter((o) => o.start.slice(0, 4) === String(year));
}

// The next `count` occurrences that have not finished as of `fromIso`. Looks a
// year at a time so a once-a-decade cadence is still found.
export function nextOccurrences(holiday, fromIso, count = 1, holidays = [], horizonYears = 60) {
  const from = parseIso(fromIso);
  if (!from) return [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i <= horizonYears && out.length < count; i++) {
    const a = i === 0 ? from : new Date(from.getFullYear() + i, 0, 1);
    const b = new Date(from.getFullYear() + i, 11, 31);
    if (b < a) continue;
    for (const o of occurrencesBetween(holiday, a, b, { holidays, stack: [holiday?.id] })) {
      if (seen.has(o.start)) continue;
      seen.add(o.start);
      out.push(o);
      if (out.length >= count) break;
    }
  }
  return out;
}

// ---- Plain-English description -------------------------------------------

const ORDINALS = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', '-1': 'last' };

export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
}

function joinList(items) {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function formatShort(iso) {
  const d = parseIso(iso);
  return d ? `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}` : '';
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function describeBase(r, holidays) {
  const monthList = joinList(r.months.map((m) => MONTH_NAMES[m - 1]));
  switch (r.kind) {
    case 'once':
      return r.date ? `Once, on ${formatShort(r.date)}` : 'Once';
    case 'date': {
      const dayText = r.day === -1 ? 'last day' : ordinal(r.day);
      if (r.months.length === 0) return `The ${dayText} of every month`;
      if (r.months.length === 1) return r.day === -1 ? `The last day of ${monthList}` : `Every ${monthList} ${r.day}`;
      return `The ${dayText} of ${monthList}`;
    }
    case 'weekday': {
      const which = `${ORDINALS[r.nth]} ${WEEKDAY_NAMES[r.weekday]}`;
      return r.months.length === 0 ? `The ${which} of every month` : `The ${which} of ${monthList}`;
    }
    case 'interval': {
      const every = r.every === 1 ? `Every ${r.unit}` : `Every ${r.every} ${r.unit}s`;
      return r.anchor ? `${every} from ${formatShort(r.anchor)}` : every;
    }
    case 'easter':
      return 'Easter Sunday';
    case 'relative': {
      const base = holidays.find((h) => h.id === r.baseId);
      return base ? `Same day as ${base.name}` : 'Follows another holiday';
    }
    default:
      return '';
  }
}

// e.g. "The last Monday of May, starting 2 days earlier, for 3 days".
export function describeRule(raw, holidays = []) {
  const r = normalizeRule(raw);
  let text = describeBase(r, holidays);

  // "3 days after Thanksgiving Day" reads better than "Same day as…, 3 days later".
  const anchored = r.kind === 'relative' || r.kind === 'easter';
  if (anchored && r.offsetDays !== 0 && r.adjust.type === 'none') {
    const baseName = r.kind === 'easter' ? 'Easter Sunday' : (holidays.find((h) => h.id === r.baseId)?.name || 'another holiday');
    text = `${plural(Math.abs(r.offsetDays), 'day')} ${r.offsetDays < 0 ? 'before' : 'after'} ${baseName}`;
  }

  const parts = [text];
  const wd = WEEKDAY_NAMES[r.adjust.weekday];
  const adjustText = {
    nearestWeekday: 'moved to the nearest weekday if it lands on a weekend',
    nextMonday: 'moved to Monday if it lands on a weekend',
    previousFriday: 'moved to Friday if it lands on a weekend',
    weekdayOnOrAfter: `moved to the ${wd} on or after`,
    weekdayOnOrBefore: `moved to the ${wd} on or before`,
    weekdayNearest: `moved to the nearest ${wd}`,
  }[r.adjust.type];
  if (adjustText) parts.push(adjustText);
  if (r.offsetDays !== 0 && !(anchored && r.adjust.type === 'none')) {
    parts.push(`${plural(Math.abs(r.offsetDays), 'day')} ${r.offsetDays < 0 ? 'earlier' : 'later'}`);
  }
  if (r.durationDays > 1) parts.push(`for ${r.durationDays} days`);
  if (r.everyYears > 1 && r.kind !== 'once' && r.kind !== 'interval') {
    parts.push(`every ${r.everyYears} years (${r.anchorYear}, ${r.anchorYear + r.everyYears}…)`);
  }
  if (r.startDate) parts.push(`from ${formatShort(r.startDate)}`);
  if (r.endDate) parts.push(`until ${formatShort(r.endDate)}`);
  return parts.join(', ');
}
