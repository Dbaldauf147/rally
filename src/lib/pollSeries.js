// Recurring events whose date is decided by a poll each time.
//
// The fixed yearly repeat (lib/recurrence.js) needs to know the date up front
// — "every July 4", "the 3rd Saturday of September". A poll series is for the
// other kind of regular thing: monthly game night, a quarterly dinner, the
// annual trip — it happens every so often, but *when* is whatever works for
// everyone that time.
//
// So each round is its own ordinary event: polled, finalized, held. Each one
// carries `pollSeries: { everyMonths, seriesId, round }`. Once a round's
// finalized date has passed, the daily job (api/poll-series.js) opens the next
// round — a new event in Voting, the same guests, its poll seeded with dates in
// the target month on the same weekdays the last round's options used — and
// links the two (`nextRoundId` on the old, `previousRoundId` on the new).
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

/* Whether this round's time is up and the next should open: it's in a series,
 * its date was finalized, it isn't cancelled, the next round doesn't exist
 * yet, and the last day of it is before today. */
export function nextRoundDue(event, now = new Date(), timeZone = 'America/New_York') {
  if (!event || !normalizePollSeries(event.pollSeries)) return false;
  if (event.cancelled || event.nextRoundId) return false;
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
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let d = 1; d <= days && out.length < MAX_SEEDED; d += 1) {
    const day = new Date(Date.UTC(year, month - 1, d));
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
  const target = targetMonth(event, series.everyMonths, timeZone);
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
    targetMonth: target,
    pollSeries: { everyMonths: series.everyMonths, seriesId: series.seriesId || eventId, round: series.round + 1 },
    previousRoundId: eventId,
  };
  if (shareToken) doc.shareToken = shareToken;
  if (Array.isArray(event.hiddenFrom)) doc.hiddenFrom = [...event.hiddenFrom];
  if (event.keyConsiderationsEnabled != null) doc.keyConsiderationsEnabled = event.keyConsiderationsEnabled;
  // The reminder schedule carries over, counted from when this round opens.
  if (reminders) doc.autoReminders = { ...reminders, ...(reminders.enabled ? { startedAt: new Date().toISOString() } : {}) };
  return { doc, target };
}
