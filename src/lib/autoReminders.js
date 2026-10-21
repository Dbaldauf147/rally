// Automatic email reminders to members who haven't voted on a date poll.
// Stored on the event as autoReminders: { enabled, intervals, startedAt }, and
// worked through once a day by api/check-reminders.js.

// Days after the clock starts that the 1st, 2nd and 3rd reminder go out.
export const DEFAULT_REMINDER_INTERVALS = [3, 5, 7];

// Reminders picked on the Create Event form are switched on before there is
// anything to remind people about — no dates on the poll, nobody invited yet.
// So they're saved "armed" (enabled, no startedAt) and the clock starts on the
// first daily check that finds a poll guests could actually answer: open date
// options, someone with an email to send to, and — for a poll-series round —
// the round's poll already emailed out.
export function readyToStartReminders(event, { openOptionCount, emailableCount }) {
  const ar = event?.autoReminders;
  if (!ar?.enabled || ar.startedAt) return false;
  if (event.pollSendDate && !event.pollSentAt) return false;
  return openOptionCount > 0 && emailableCount > 0;
}

// The daily check (vercel.json: "0 14 * * *") is the only thing that sends.
export const REMINDER_CRON_UTC_HOUR = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

// Members a reminder can go to at all: an email, on the poll, and not someone
// the event is hidden from (an email would give a surprise away).
export function remindableMembers(event) {
  const hiddenFrom = new Set((Array.isArray(event?.hiddenFrom) ? event.hiddenFrom : [])
    .map((e) => String(e || '').trim().toLowerCase()));
  return Object.entries(event?.members || {}).filter(([, m]) => m && typeof m === 'object'
    && m.email && !m.skipVote && !hiddenFrom.has(String(m.email).trim().toLowerCase()));
}

// The dates a guest is asked about: open, and not reference-only (noVote,
// which the poll page doesn't let anyone answer), soonest first.
export function pollOptions(options) {
  return (options || []).filter((o) => o && !o.closed && !o.noVote)
    .sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')));
}

const ANSWERS = new Set(['yes', 'maybe', 'no']);

// Each poll date with this member's own answer, or null where they haven't
// given one. Reminders keep going until there are no nulls left.
export function reminderAnswers(uid, options) {
  return pollOptions(options).map((option) => {
    const vote = option.votes?.[uid]?.vote;
    return { option, vote: ANSWERS.has(vote) ? vote : null };
  });
}

export const hasMissingAnswers = (uid, options) => reminderAnswers(uid, options).some((a) => !a.vote);

// The first daily check at or after `t`. A check that started in the last hour
// still counts: the weekly digest shares that 14:00 slot, so "today" is right
// for a reminder that run is sending.
function nextCheckAt(t) {
  const slot = new Date(t);
  slot.setUTCHours(REMINDER_CRON_UTC_HOUR, 0, 0, 0);
  while (slot.getTime() < t.getTime() - 60 * 60 * 1000) slot.setTime(slot.getTime() + DAY_MS);
  return slot;
}

// What the reminder schedule will do next, as api/check-reminders.js would
// work it out. `openOptions` are the event's dateOptions.
//   off       — not switched on
//   armed     — on, but the clock hasn't started (see readyToStartReminders)
//   scheduled — `at` is the next send, to `count` people; `reminder` is which
//               of `total` it is (null when that differs between them)
//   done      — nobody left with a date unanswered; `exhausted` of them ran out of reminders
export function nextReminder(event, { openOptions = [], now = new Date() } = {}) {
  const ar = event?.autoReminders;
  const intervals = Array.isArray(ar?.intervals) ? ar.intervals : [];
  if (!ar?.enabled || intervals.length === 0 || event.cancelled || event.stage === 'finalized') return { state: 'off' };
  const total = intervals.length;
  if (!ar.startedAt) return { state: 'armed', total };

  const startedAt = new Date(ar.startedAt);
  let best = null;
  let exhausted = 0;
  for (const [uid, m] of remindableMembers(event)) {
    if (!hasMissingAnswers(uid, openOptions)) continue;
    const sent = m.autoRemindersSent || 0;
    if (sent >= total) { exhausted += 1; continue; }
    const due = new Date(startedAt.getTime() + intervals[sent] * DAY_MS);
    const at = nextCheckAt(due > now ? due : now);
    // A check sends once floor(days since start) reaches the interval. Checks
    // land a few seconds into the 14:00 minute, as does a startedAt the check
    // itself stamped, so judge each one at the end of that minute.
    while (Math.floor((at - startedAt + 60 * 1000) / DAY_MS) < intervals[sent]) at.setTime(at.getTime() + DAY_MS);
    const t = at.getTime();
    if (!best || t < best.t) best = { t, count: 1, reminder: sent + 1 };
    else if (t === best.t) {
      best.count += 1;
      // People further along the schedule can land on the same day.
      if (best.reminder !== sent + 1) best.reminder = null;
    }
  }
  if (!best) return { state: 'done', total, exhausted };
  return { state: 'scheduled', at: new Date(best.t), count: best.count, reminder: best.reminder, total };
}

// The dates a member was sent a reminder, oldest first. Sends are logged in
// autoReminderLog; before that only the latest (lastAutoReminder) was kept, so
// `unknown` counts sends whose date was never recorded.
export function reminderSendDates(member) {
  const log = Array.isArray(member?.autoReminderLog) ? member.autoReminderLog : [];
  const iso = new Set(log);
  if (member?.lastAutoReminder) iso.add(member.lastAutoReminder);
  const dates = [...iso].map((s) => new Date(s)).filter((d) => !isNaN(d)).sort((a, b) => a - b);
  const unknown = Math.max(0, (member?.autoRemindersSent || 0) - dates.length);
  return { dates, unknown };
}
