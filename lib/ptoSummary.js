// The annual PTO summary email: what's been taken this year, what's on the
// calendar still to come, and how many days are left to plan.
//
// Reads the same users/<uid>.pto the PTO page writes ({ years, entries }) and
// counts the way the page's dashboard does — an entry belongs to the year its
// start date falls in, and it's "taken" once that date is before today,
// "scheduled" from today on — so the email and the page always agree.
//
// Pure, so it can be tested; api/pto-summary.js does the reading and sending.

export const OWNER_EMAIL = 'baldaufdan@gmail.com';
export const DEFAULT_RECIPIENT = 'daniel.baldauf@se.com';
export const MAX_RECIPIENTS = 10;
export const SEND_MONTH = 11; // November
export const SEND_DAY = 1;
export const SEND_HOUR = 8; // 8 AM in the configured timezone
const DEFAULT_TZ = 'America/New_York';

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s ?? '').trim());

/* The settings as they apply, with the defaults filled in. Only the owner's
   account starts switched on and addressed to the work inbox — anyone else
   who somehow has PTO data gets nothing until they turn it on themselves. An
   address list you've saved (even an emptied one) always wins. */
export function ptoSummaryConfig(userData) {
  const raw = userData?.ptoSummary && typeof userData.ptoSummary === 'object' ? userData.ptoSummary : {};
  const isOwner = String(userData?.email || '').toLowerCase() === OWNER_EMAIL;
  const emails = Array.isArray(raw.emails)
    ? raw.emails.map((e) => String(e ?? '').trim()).filter(isEmail)
    : (isOwner ? [DEFAULT_RECIPIENT] : []);
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : isOwner,
    emails: [...new Set(emails.map((e) => e.toLowerCase()))].slice(0, MAX_RECIPIENTS),
    timezone: raw.timezone || DEFAULT_TZ,
    lastSentYear: raw.lastSentYear ?? null,
  };
}

function localParts(date, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || DEFAULT_TZ,
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23',
    }).formatToParts(date);
    const get = (t) => Number(parts.find((p) => p.type === t)?.value);
    return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
  } catch {
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours() };
  }
}

// "2026-11-01" — today in the given timezone.
export function localIso(date, tz) {
  const p = localParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/* Whether the cron run at `now` should send.

   November 1st at 8 AM in the configured timezone, once a year. vercel.json
   fires the route at 12:00 and 13:00 UTC on Nov 1 because 8 AM Eastern is one
   or the other depending on whether daylight saving has ended yet; the first
   run at or after 8 sends, the second finds this year already sent (and is a
   retry if the first failed). */
export function isPtoSummaryDue(cfg, now = new Date()) {
  if (!cfg?.enabled || !cfg.emails?.length) return false;
  const p = localParts(now, cfg.timezone);
  if (p.month !== SEND_MONTH || p.day !== SEND_DAY || p.hour < SEND_HOUR) return false;
  return Number(cfg.lastSentYear) !== p.year;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const nameOf = (e) => String(e?.rallyName || e?.label || 'Time off').trim() || 'Time off';

function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}
const isoOf = (d) => d.toISOString().slice(0, 10);

// The next weekday after an ISO date.
function nextWeekday(iso) {
  const d = parseIso(iso);
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return isoOf(d);
}

/* Log rows as stretches: back-to-back weekdays under the same name become one
   line ("Spring break, Mon Mar 2 – Fri Mar 6, 5 days"), since the Google
   import writes a row per day. Expects rows sorted by start. */
export function groupStretches(rows) {
  const out = [];
  rows.forEach((e) => {
    const start = String(e.start).slice(0, 10);
    const end = String(e.end || e.start).slice(0, 10) >= start ? String(e.end || e.start).slice(0, 10) : start;
    const prev = out[out.length - 1];
    if (prev && prev.name === nameOf(e) && nextWeekday(prev.end) === start) {
      prev.end = end;
      prev.days += num(e.days);
      return;
    }
    out.push({ name: nameOf(e), start, end, days: num(e.days), note: String(e.note || '').trim() });
  });
  return out;
}

/* The year's numbers and lists. `todayIso` is today in the owner's timezone.

   left = allowance − taken − scheduled (the page's "Unplanned"). If the year
   keeps an end-of-year backup, `afterBackup` is what's left once that's set
   aside. */
export function summarizePtoYear(pto, year, todayIso) {
  const years = Array.isArray(pto?.years) ? pto.years : [];
  const cfgYear = years.find((y) => Number(y?.year) === Number(year)) || null;
  const entries = (Array.isArray(pto?.entries) ? pto.entries : [])
    .filter((e) => parseIso(e?.start)?.getUTCFullYear() === Number(year))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));

  const takenRows = entries.filter((e) => String(e.start).slice(0, 10) < todayIso);
  const scheduledRows = entries.filter((e) => String(e.start).slice(0, 10) >= todayIso);
  const total = num(cfgYear?.total);
  const taken = takenRows.reduce((n, e) => n + num(e.days), 0);
  const scheduled = scheduledRows.reduce((n, e) => n + num(e.days), 0);
  const left = total - taken - scheduled;
  const eoyBackup = num(cfgYear?.eoyBackup);

  return {
    year: Number(year),
    asOf: todayIso,
    hasYear: !!cfgYear,
    total,
    taken,
    scheduled,
    left,
    eoyBackup,
    afterBackup: left - eoyBackup,
    takenList: groupStretches(takenRows),
    scheduledList: groupStretches(scheduledRows),
  };
}

// --- the email ---------------------------------------------------------------

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// 2 → "2", 1.5 → "1.5", -0.5 → "−0.5"
export function fmtDays(n) {
  const v = Math.round(num(n) * 100) / 100;
  return `${v < 0 ? '−' : ''}${Math.abs(v)}`;
}
const dayWord = (n) => (num(n) === 1 ? 'day' : 'days');

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso) {
  const d = parseIso(iso);
  return d ? `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()}` : esc(iso);
}
export const fmtRange = (s) => (s.end && s.end !== s.start ? `${fmtDate(s.start)} – ${fmtDate(s.end)}` : fmtDate(s.start));

function stat(label, value, colour, sub = '') {
  return `<td style="padding:0.75rem 0.5rem;text-align:center;border:1px solid #e5e7eb;border-radius:10px;width:25%;">
    <div style="font-size:1.6rem;font-weight:700;color:${colour};line-height:1.1;">${value}</div>
    <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-top:0.25rem;">${label}</div>
    ${sub ? `<div style="font-size:0.72rem;color:#9ca3af;margin-top:0.15rem;">${sub}</div>` : ''}
  </td>`;
}

function listTable(title, rows, emptyText) {
  const body = rows.length
    ? rows.map((r) => `<tr>
        <td style="padding:0.4rem 0.5rem;border-bottom:1px solid #f0f0f0;white-space:nowrap;color:#111827;">${fmtRange(r)}</td>
        <td style="padding:0.4rem 0.5rem;border-bottom:1px solid #f0f0f0;color:#374151;">${esc(r.name)}</td>
        <td style="padding:0.4rem 0.5rem;border-bottom:1px solid #f0f0f0;text-align:right;white-space:nowrap;color:#111827;font-weight:600;">${fmtDays(r.days)} ${dayWord(r.days)}</td>
      </tr>`).join('')
    : `<tr><td colspan="3" style="padding:0.5rem;color:#9ca3af;">${emptyText}</td></tr>`;
  return `<h2 style="font-size:1rem;margin:1.5rem 0 0.4rem;color:#111827;">${title}</h2>
    <table style="width:100%;border-collapse:collapse;font-size:0.88rem;">${body}</table>`;
}

export function buildPtoEmail(s, appUrl = 'https://rally-seven-theta.vercel.app') {
  const leftColour = s.left < 0 ? '#dc2626' : '#4f46e5';
  const backupLine = s.eoyBackup > 0
    ? `<p style="margin:0.75rem 0 0;font-size:0.85rem;color:#374151;">Keeping your ${fmtDays(s.eoyBackup)}-day end-of-year backup leaves <strong>${fmtDays(s.afterBackup)} ${dayWord(s.afterBackup)}</strong> to plan.</p>`
    : '';
  const noYear = s.hasYear ? '' : `<p style="margin:0.75rem 0 0;font-size:0.85rem;color:#b45309;">There's no ${s.year} allowance set on the PTO page, so days left can't be worked out — add the year there.</p>`;

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:1.5rem;color:#111827;">
    <h1 style="font-size:1.35rem;margin:0 0 0.25rem;">🌴 Your ${s.year} PTO</h1>
    <p style="margin:0 0 1rem;color:#6b7280;font-size:0.9rem;">Where your time off stands as of ${fmtDate(s.asOf)}.</p>
    <table style="width:100%;border-collapse:separate;border-spacing:6px;margin:0 -6px;">
      <tr>
        ${stat('Days left', fmtDays(s.left), leftColour, 'not yet scheduled')}
        ${stat('Scheduled', fmtDays(s.scheduled), '#0f766e', 'still to come')}
        ${stat('Taken', fmtDays(s.taken), '#111827', 'so far')}
        ${stat('Allowance', fmtDays(s.total), '#6b7280', `for ${s.year}`)}
      </tr>
    </table>
    ${backupLine}${noYear}
    ${listTable('Scheduled', s.scheduledList, 'Nothing on the calendar yet.')}
    ${listTable('Taken', s.takenList, 'No days taken yet this year.')}
    <div style="margin:1.5rem 0 0;">
      <a href="${appUrl}/pto" style="display:inline-block;background:#4f46e5;color:#fff;padding:0.55rem 1.1rem;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.88rem;">Open PTO in Rally</a>
    </div>
    <p style="color:#9ca3af;font-size:0.75rem;margin-top:1.5rem;">Sent every November 1st by Rally. Change where it goes, or turn it off, on the PTO page.</p>
  </div>`;

  const subject = `${s.year} PTO: ${fmtDays(s.left)} ${dayWord(s.left)} left, ${fmtDays(s.scheduled)} scheduled, ${fmtDays(s.taken)} taken`;
  return { subject, html };
}
