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

// The members a running schedule still owes a reminder: an email to send to,
// a vote they're expected to cast and haven't, not hidden from the event, and
// reminders left to send. `voterUids` is everyone who has voted on an open
// date option. Shared by the cron that sends and the digest that reports, so
// the two can't disagree about who is next.
export function pendingReminderMembers(event, voterUids) {
  const ar = event?.autoReminders;
  const intervals = Array.isArray(ar?.intervals) ? ar.intervals : [];
  const hiddenFrom = new Set((Array.isArray(event?.hiddenFrom) ? event.hiddenFrom : [])
    .map((e) => String(e || '').trim().toLowerCase()));
  return Object.entries(event?.members || {}).filter(([uid, m]) => m && typeof m === 'object'
    && m.email && !m.skipVote
    && !hiddenFrom.has(String(m.email).trim().toLowerCase())
    && !voterUids.has(uid)
    && (m.autoRemindersSent || 0) < intervals.length);
}

// The cron's time of day (vercel.json: check-reminders, "0 14 * * *").
const CRON_HOUR_UTC = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

// The first daily run at or after `t` — when something due at `t` is sent.
function firstRunFrom(t) {
  const run = new Date(t);
  run.setUTCHours(CRON_HOUR_UTC, 0, 0, 0);
  if (run < t) run.setUTCDate(run.getUTCDate() + 1);
  return run;
}

/* Where an event's automatic reminders stand, for the weekly digest.

   { state: 'off' }                  — never switched on
   { state: 'waiting' }              — switched on, clock not started (see above)
   { state: 'done' }                 — nobody left to remind
   { state: 'scheduled', at, count } — the next send: the daily run that
                                       picks it up, and how many go out then

   The cron sends a member's next reminder on the first run at least
   intervals[sent] whole days after startedAt, so that's the run reported. One
   already overdue (a failed send) goes on the next run from `now`. */
export function nextReminderSend(event, voterUids, now = new Date()) {
  const ar = event?.autoReminders;
  if (!ar?.enabled || !Array.isArray(ar.intervals) || ar.intervals.length === 0) return { state: 'off' };
  if (!ar.startedAt) return { state: 'waiting' };
  const started = new Date(ar.startedAt);
  if (isNaN(started)) return { state: 'waiting' };
  const runs = pendingReminderMembers(event, voterUids).map(([, m]) => {
    const due = new Date(started.getTime() + ar.intervals[m.autoRemindersSent || 0] * DAY_MS);
    return firstRunFrom(due < now ? now : due).getTime();
  });
  if (!runs.length) return { state: 'done' };
  const at = Math.min(...runs);
  return { state: 'scheduled', at: new Date(at), count: runs.filter((r) => r === at).length };
}
