// The automatic poll reminder (api/check-reminders.js): every date on the poll
// with the guest's answer so far, the unanswered ones marked, so they can see
// exactly what's left rather than being told they "haven't voted".
//
// Kept outside api/ so Vercel doesn't route it.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Same marks as the vote table in the app.
const ANSWER_LOOK = {
  yes: { text: '✓ Works', color: '#16a34a', bg: '#dcfce7' },
  maybe: { text: '? Maybe', color: '#b45309', bg: '#fef3c7' },
  no: { text: '✗ Can’t', color: '#dc2626', bg: '#fee2e2' },
};

// "Thu, Nov 5", or "Fri, Nov 6 – Sun, Nov 8" for a range. Dates are calendar
// days with no time zone, so they're read and printed as UTC.
export function optionLabel(o) {
  const day = (ds) => {
    const d = new Date(`${ds}T00:00:00Z`);
    return isNaN(d) ? null : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  const start = o?.startDate && day(o.startDate);
  if (!start) return o?.note || 'Date';
  const end = o.endDate && o.endDate !== o.startDate ? day(o.endDate) : null;
  return end ? `${start} – ${end}` : start;
}

/* answers: [{ option, vote }] from reminderAnswers(), vote null when missing. */
export function renderReminderEmail({ name, eventTitle, location, answers, pollLink, reminderNum, totalReminders, fromName }) {
  const missing = answers.filter((a) => !a.vote).length;
  const answered = answers.length - missing;
  const isLast = reminderNum === totalReminders;
  const datesWord = (n) => `${n} date${n === 1 ? '' : 's'}`;
  const title = eventTitle || 'your event';

  const subject = isLast
    ? `Final reminder: ${fromName} needs your answer on ${title}`
    : answered === 0
      ? `Reminder ${reminderNum}/${totalReminders}: ${fromName} is waiting for your vote on ${title}`
      : `Reminder ${reminderNum}/${totalReminders}: ${missing === 1 ? '1 date still needs' : `${missing} dates still need`} your answer for ${title}`;

  const lead = answered === 0
    ? `We haven't heard from you yet. Please let ${esc(fromName)} know which dates work.`
    : `Thanks for answering ${datesWord(answered)}! ${missing === 1 ? 'One date still needs' : `${missing} dates still need`} an answer.`;
  const urgency = isLast
    ? `<p style="color: #dc2626; font-weight: 600; margin: 0 0 1rem;">This is a final reminder — please respond so we can finalize plans!</p>`
    : '';

  const rows = answers.map(({ option, vote }) => {
    const look = ANSWER_LOOK[vote];
    const cell = look
      ? `<span style="display: inline-block; padding: 2px 10px; border-radius: 999px; background: ${look.bg}; color: ${look.color}; font-weight: 600;">${look.text}</span>`
      : `<span style="display: inline-block; padding: 2px 10px; border-radius: 999px; background: #fff7ed; color: #c2410c; border: 1px dashed #fb923c; font-weight: 700;">No answer yet</span>`;
    const note = option.note ? `<div style="color: #6b7280; font-size: 0.78rem; margin-top: 2px;">${esc(option.note)}</div>` : '';
    return `
      <tr style="${look ? '' : 'background: #fffbeb;'}">
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee; font-weight: ${look ? 500 : 700}; color: #1f2937;">${esc(optionLabel(option))}${note}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee; text-align: right; white-space: nowrap;">${cell}</td>
      </tr>`;
  }).join('');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 2rem;">
      <h1 style="font-size: 1.5rem; color: #4f46e5; margin: 0 0 0.5rem;">Rally</h1>
      <p style="color: #525252; margin: 0 0 1rem;">Hey${name ? ` ${esc(name)}` : ''}! 👋</p>
      ${urgency}
      <p style="color: #525252; margin: 0 0 1rem;">${lead}</p>
      <div style="background: #f5f3ef; border-radius: 12px; padding: 1.25rem 1.5rem; margin: 1rem 0;">
        <h2 style="font-size: 1.2rem; margin: 0 0 0.25rem; color: #1a1a1a;">${esc(title)}</h2>
        ${location ? `<p style="color: #525252; margin: 0;">📍 ${esc(location)}</p>` : ''}
      </div>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; font-size: 0.9rem;">
        <thead>
          <tr>
            <th style="padding: 8px 12px; text-align: left; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; background: #f9fafb; border-bottom: 1px solid #e5e7eb;">Date</th>
            <th style="padding: 8px 12px; text-align: right; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; background: #f9fafb; border-bottom: 1px solid #e5e7eb;">Your answer</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <a href="${esc(pollLink)}" style="display: inline-block; background: #4f46e5; color: #fff; padding: 0.75rem 2rem; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 1.25rem;">${answered === 0 ? 'Vote Now' : `Answer the ${missing === 1 ? 'missing date' : 'missing dates'}`}</a>
      <p style="color: #9ca3af; font-size: 0.75rem; margin-top: 2rem;">Reminder ${reminderNum} of ${totalReminders}. If you didn't expect this email, you can safely ignore it.</p>
    </div>`;

  return { subject, html };
}

// "Saturday, Nov 14 · 6:00 PM", or "Fri, Nov 13 – Sun, Nov 15" for a range;
// no clock for an all-day event. Printed in Eastern time, like the reminder
// days are counted (src/lib/eventReminders.js).
export function eventWhenLabel({ date, endDate, allDay }, timeZone = 'America/New_York') {
  const toDate = (v) => {
    if (v == null || v === '') return null;
    const d = typeof v?.toDate === 'function' ? v.toDate() : new Date(v);
    return isNaN(d) ? null : d;
  };
  const start = toDate(date);
  if (!start) return '';
  const day = (d, weekday) => d.toLocaleDateString('en-US', { weekday, month: 'short', day: 'numeric', timeZone });
  const end = toDate(endDate);
  const sameDay = (a, b) => day(a, 'short') === day(b, 'short');
  if (end && !sameDay(start, end)) return `${day(start, 'short')} – ${day(end, 'short')}`;
  const clock = allDay ? '' : ` · ${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })}`;
  return `${day(start, 'long')}${clock}`;
}

/* The upcoming-event reminder (api/check-reminders.js), for the people who
   said yes or maybe. daysAway: 0 on the day, 1 for tomorrow, … */
export function renderEventReminderEmail({ name, eventTitle, when, location, daysAway, link, fromName }) {
  const title = eventTitle || 'your event';
  const soon = daysAway === 0 ? 'today' : daysAway === 1 ? 'tomorrow' : `in ${daysAway} days`;
  const subject = `Reminder: ${title} is ${soon}${when ? ` (${when})` : ''}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 2rem;">
      <h1 style="font-size: 1.5rem; color: #4f46e5; margin: 0 0 0.5rem;">Rally</h1>
      <p style="color: #525252; margin: 0 0 1rem;">Hey${name ? ` ${esc(name)}` : ''}! 👋</p>
      <p style="color: #525252; margin: 0 0 1rem;">Just a reminder that ${esc(title)} is <strong>${soon}</strong>. ${esc(fromName || 'The organizer')} is counting you in — if your plans have changed, please let them know.</p>
      <div style="background: #f5f3ef; border-radius: 12px; padding: 1.25rem 1.5rem; margin: 1rem 0;">
        <h2 style="font-size: 1.2rem; margin: 0 0 0.25rem; color: #1a1a1a;">${esc(title)}</h2>
        ${when ? `<p style="color: #525252; margin: 0 0 0.15rem;">📅 ${esc(when)}</p>` : ''}
        ${location ? `<p style="color: #525252; margin: 0;">📍 ${esc(location)}</p>` : ''}
      </div>
      <a href="${esc(link)}" style="display: inline-block; background: #4f46e5; color: #fff; padding: 0.75rem 2rem; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 0.5rem;">See the details</a>
      <p style="color: #9ca3af; font-size: 0.75rem; margin-top: 2rem;">You're getting this because you said yes or maybe. If you didn't expect this email, you can safely ignore it.</p>
    </div>`;
  return { subject, html };
}
