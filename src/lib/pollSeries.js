// Recurring events whose date is decided by a poll each time.
//
// The fixed yearly repeat (lib/recurrence.js) needs to know the date up front
// — "every July 4", "the 3rd Saturday of September". A poll series is for the
// other kind of regular thing: monthly game night, a quarterly dinner, the
// annual trip — it happens every so often, but *when* is whatever works for
// everyone that time.
//
// So each round is its own ordinary event: polled, finalized, held. Each one
// carries `pollSeries: { everyMonths, seriesId, round }` and the day its poll
// goes out, `pollSendDate` (YYYY-MM-DD) — the owner picks the first one, and
// each round after goes out the same day of the month, one cadence later.
//
// The daily job (api/poll-series.js) does two things on those days:
//   • on a round's send date, emails everyone on its guest list to suggest
//     dates and vote (`pollSentAt` records that it went);
//   • on the *next* send date, opens the next round — a new event in Voting,
//     the same guests, its poll seeded with dates on the same weekdays the last
//     round's options used — and links the two (`nextRoundId` on the old,
//     `previousRoundId` on the new). Then that round's email goes the same run.
//
// A round's poll offers dates from a week after it goes out (time to answer)
// to a week after the next one goes out — one cadence's worth of dates.
//
// Series made before send dates existed have no `pollSendDate`; theirs opens
// the next round once the current round's finalized date has passed, and
// sends no email.
//
// Turning the repeat off on the latest round ends the series there.
//
// Pure: no Firestore, no DOM. The page and the job both import it.

export const CADENCES = [
  { months: 1, label: 'Every month' },
  { months: 2, label: 'Every 2 months' },
  { months: 3, label: 'Every 3 months' },
  { months: 6, label: 'Every 6 months' },
  { months: 12, label: 'Every year' },
];
const ALLOWED = new Set(CADENCES.map((c) => c.months));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// How many dates a new round's poll opens with at most — a month of every
// weekday would be a wall nobody votes through.
export const MAX_SEEDED = 12;

// The series a stored event belongs to, or null. Missing ids are filled in by
// the job (the first round's own id becomes the series id).
export function normalizePollSeries(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const everyMonths = Number(raw.everyMonths);
  if (!ALLOWED.has(everyMonths)) return null;
  const round = Math.max(1, Math.floor(Number(raw.round) || 1));
  return { everyMonths, seriesId: String(raw.seriesId || ''), round };
}

export const cadenceLabel = (everyMonths) => CADENCES.find((c) => c.months === everyMonths)?.label || `Every ${everyMonths} months`;

export function describePollSeries(series) {
  const s = normalizePollSeries(series);
  if (!s) return '';
  return `${cadenceLabel(s.everyMonths)} — a new poll picks each round's date`;
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseYmd = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
};
const toDate = (v) => {
  if (!v) return null;
  const d = v.toDate ? v.toDate() : v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

// A calendar day as YYYY-MM-DD in a time zone — the day a person there would
// say the event was on.
export function dayInZone(date, timeZone = 'America/New_York') {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !!parseYmd(v);

// The same day of the month `n` months on, held to the month's last day (a
// Jan 31 send goes out Feb 28). YYYY-MM-DD in, YYYY-MM-DD out.
export function addMonthsYmd(ymdStr, n) {
  const d = parseYmd(ymdStr);
  if (!d) return '';
  const y = d.getUTCFullYear();
  const index = d.getUTCMonth() + n;
  const ty = y + Math.floor(index / 12);
  const tm = ((index % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return ymd(new Date(Date.UTC(ty, tm, Math.min(d.getUTCDate(), last))));
}
const addDaysYmd = (ymdStr, n) => {
  const d = parseYmd(ymdStr);
  return d ? ymd(new Date(d.getTime() + n * 86400000)) : '';
};

// When the round after this one goes out, or '' for a series without dates.
export function nextSendDate(event) {
  const series = normalizePollSeries(event?.pollSeries);
  if (!series || !isYmd(event?.pollSendDate)) return '';
  return addMonthsYmd(event.pollSendDate, series.everyMonths);
}

// The dates a round's poll offers: from a week after it goes out, to a week
// after the next one does. { from, to }, both YYYY-MM-DD and inclusive.
export const WINDOW_LEAD_DAYS = 7;
export function pollWindow(sendDate, everyMonths) {
  if (!isYmd(sendDate)) return null;
  return {
    from: addDaysYmd(sendDate, WINDOW_LEAD_DAYS),
    to: addDaysYmd(addMonthsYmd(sendDate, everyMonths), WINDOW_LEAD_DAYS - 1),
  };
}

// "Oct 20" / "Oct 20, 2027" — a send date as the page and email say it.
export function sendDateLabel(ymdStr, today = '') {
  const d = parseYmd(ymdStr);
  if (!d) return '';
  const month = MONTHS[d.getUTCMonth()].slice(0, 3);
  const sameYear = today && today.slice(0, 4) === ymdStr.slice(0, 4);
  return sameYear ? `${month} ${d.getUTCDate()}` : `${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/* Whether this round's poll email should go now: it's in a series, has a
 * send date that's today or past, hasn't gone, and isn't cancelled. */
export function pollSendDue(event, now = new Date(), timeZone = 'America/New_York') {
  if (!event || !normalizePollSeries(event.pollSeries)) return false;
  if (event.cancelled || event.pollSentAt || !isYmd(event.pollSendDate)) return false;
  return event.pollSendDate <= dayInZone(now, timeZone);
}

/* Whether the next round should open now. With send dates: when the next send
 * date arrives, whatever state this round is in — the schedule is the owner's.
 * Without (older series): once this round is finalized and its last day is
 * behind us. Either way, not if it's cancelled or the next round exists. */
export function nextRoundDue(event, now = new Date(), timeZone = 'America/New_York') {
  if (!event || !normalizePollSeries(event.pollSeries)) return false;
  if (event.cancelled || event.nextRoundId) return false;
  if (isYmd(event.pollSendDate)) return nextSendDate(event) <= dayInZone(now, timeZone);
  if ((event.stage || 'voting') !== 'finalized' || event.dateTBD) return false;
  const last = toDate(event.endDate) || toDate(event.date);
  if (!last) return false;
  return dayInZone(last, timeZone) < dayInZone(now, timeZone);
}

// The month the next round's poll covers: the month this round happened in,
// moved on by the cadence. { year, month } with month 1-12.
export function targetMonth(event, everyMonths, timeZone = 'America/New_York') {
  const start = toDate(event.date) || new Date();
  const [y, m] = dayInZone(start, timeZone).split('-').map(Number);
  const index = (m - 1) + everyMonths;
  return { year: y + Math.floor(index / 12), month: (index % 12) + 1 };
}

export const monthLabel = ({ year, month }) => `${MONTHS[month - 1]} ${year}`;

/* The dates a new round's poll opens with: every day in the target month that
 * falls on a weekday last round's options used, each as long as those options
 * were (a Fri–Sun weekend stays a Fri–Sun weekend). No options last time →
 * the weekday the round actually landed on. Capped at MAX_SEEDED, earliest
 * first. Returns [{ startDate, endDate }] as YYYY-MM-DD. */
export function seedOptions(lastOptions, { year, month }, fallbackDay = null) {
  const from = `${year}-${pad(month)}-01`;
  const to = ymd(new Date(Date.UTC(year, month, 0)));
  return seedOptionsInRange(lastOptions, { from, to }, fallbackDay);
}

// The same, over any span of days ({ from, to } inclusive, YYYY-MM-DD).
export function seedOptionsInRange(lastOptions, { from, to }, fallbackDay = null) {
  const spans = new Map(); // weekday -> span in days (the longest seen)
  for (const o of Array.isArray(lastOptions) ? lastOptions : []) {
    const s = parseYmd(o?.startDate);
    if (!s) continue;
    const e = parseYmd(o?.endDate) || s;
    const span = Math.max(0, Math.min(13, Math.round((e - s) / 86400000)));
    const wd = s.getUTCDay();
    spans.set(wd, Math.max(spans.get(wd) ?? 0, span));
  }
  if (spans.size === 0) {
    const f = parseYmd(fallbackDay);
    if (!f) return [];
    spans.set(f.getUTCDay(), 0);
  }
  const out = [];
  const first = parseYmd(from);
  const last = parseYmd(to);
  if (!first || !last) return [];
  for (let t = first.getTime(); t <= last.getTime() && out.length < MAX_SEEDED; t += 86400000) {
    const day = new Date(t);
    if (!spans.has(day.getUTCDay())) continue;
    const end = new Date(day.getTime() + spans.get(day.getUTCDay()) * 86400000);
    out.push({ startDate: ymd(day), endDate: ymd(end) });
  }
  return out;
}

// "Fridays & Saturdays" — which days a seeded poll offered, for the event page.
export function seededWeekdaysLabel(options) {
  const set = [...new Set((options || []).map((o) => parseYmd(o.startDate)?.getUTCDay()).filter((x) => x != null))].sort();
  const names = set.map((i) => `${WEEKDAYS[i]}s`);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

// Per-round fields on a guest that shouldn't follow them into the next round.
const ROUND_MEMBER_FIELDS = ['rsvp', 'emailed', 'texted', 'skipVote', 'foodOrder', 'attendance', 'lastAutoReminder', 'autoRemindersSent'];

// The guest list, as it should start the next round: the same people with the
// same details and groups, but nobody has answered anything yet. The owner is
// going, as on any new event.
export function nextRoundMembers(members) {
  const out = {};
  for (const [key, m] of Object.entries(members && typeof members === 'object' ? members : {})) {
    if (!m || typeof m !== 'object') continue;
    const next = { ...m };
    for (const f of ROUND_MEMBER_FIELDS) delete next[f];
    next.rsvp = m.role === 'owner' ? 'yes' : 'pending';
    out[key] = next;
  }
  return out;
}

/* The next round's event doc (without timestamps, which the writer adds), from
 * the round that just happened and its id. `date` is the first of the target
 * month — a TBD event still sorts by its date — and the poll picks the real
 * one. */
export function buildNextRound(event, eventId, { timeZone = 'America/New_York', shareToken } = {}) {
  const series = normalizePollSeries(event.pollSeries);
  const sendDate = nextSendDate(event);
  const window = sendDate ? pollWindow(sendDate, series.everyMonths) : null;
  // With send dates the poll covers its window; without, the target month.
  const target = window
    ? { year: Number(window.from.slice(0, 4)), month: Number(window.from.slice(5, 7)) }
    : targetMonth(event, series.everyMonths, timeZone);
  const reminders = event.autoReminders && typeof event.autoReminders === 'object' ? event.autoReminders : null;
  const doc = {
    title: event.title || 'Untitled event',
    description: event.description || '',
    location: event.location || '',
    planning: event.planning || { itinerary: false, travel: false, lodging: false },
    createdBy: event.createdBy,
    memberUids: Array.isArray(event.memberUids) ? [...event.memberUids] : [],
    members: nextRoundMembers(event.members),
    visibility: event.visibility || 'private',
    stage: 'voting',
    dateTBD: true,
    allDay: false,
    endDate: null,
    recurrence: null,
    pollSeries: { everyMonths: series.everyMonths, seriesId: series.seriesId || eventId, round: series.round + 1 },
    previousRoundId: eventId,
  };
  if (window) {
    doc.pollSendDate = sendDate;
    doc.pollWindow = window;
  } else {
    doc.targetMonth = target;
  }
  if (shareToken) doc.shareToken = shareToken;
  if (Array.isArray(event.hiddenFrom)) doc.hiddenFrom = [...event.hiddenFrom];
  if (event.keyConsiderationsEnabled != null) doc.keyConsiderationsEnabled = event.keyConsiderationsEnabled;
  // The reminder schedule carries over, counted from when this round opens.
  if (reminders) doc.autoReminders = { ...reminders, ...(reminders.enabled ? { startedAt: new Date().toISOString() } : {}) };
  return { doc, target, window };
}

// A window as a phrase: "Oct 27 – Nov 26".
export function windowLabel(window) {
  if (!window) return '';
  return `${sendDateLabel(window.from, window.from)} – ${sendDateLabel(window.to, window.from)}`;
}
