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
