// The email a poll-series round sends on its send date: "time to pick a date
// for <event> — suggest dates and vote". One per guest, each with their own
// poll link. Pure, so the wording and the recipient rules can be tested; the
// sending is api/poll-series.js's.

import { normalizePollSeries, windowLabel } from './pollSeries.js';

export const APP_URL = 'https://rally-seven-theta.vercel.app';

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Who gets it: every guest with an email address, except the organizer (they
 * had the heads-up a week earlier) and anyone the event is hidden from (a
 * surprise stays a surprise). One email per address. [{ key, member }]. */
export function pollRecipients(event) {
  const hidden = new Set((Array.isArray(event?.hiddenFrom) ? event.hiddenFrom : []).map((e) => String(e || '').trim().toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const [key, m] of Object.entries(event?.members || {})) {
    if (!m || typeof m !== 'object' || m.role === 'owner') continue;
    const email = String(m.email || '').trim().toLowerCase();
    if (!email || !email.includes('@') || hidden.has(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ key, member: m });
  }
  return out;
}

export const ownerName = (event) =>
  Object.values(event?.members || {}).find((m) => m?.role === 'owner')?.name || 'Your host';

// Their own link: the poll page keys their votes to this member rather than
// minting a duplicate person — the same link the reminder emails use.
export const pollLink = (eventId, key, member) =>
  `${APP_URL}/poll/${eventId}?name=${encodeURIComponent(member?.name || 'Friend')}&vid=${encodeURIComponent(key)}`;

export function pollInviteEmail({ event, eventId, key, member }) {
  const from = ownerName(event);
  const title = event?.title || 'the next get-together';
  const series = normalizePollSeries(event?.pollSeries);
  const window = event?.pollWindow ? windowLabel(event.pollWindow) : '';
  const link = pollLink(eventId, key, member);
  const firstName = String(member?.name || '').trim().split(/\s+/)[0];
  const subject = `${from} is picking a date for ${title} — suggest dates & vote`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:2rem;">
      <h1 style="font-size:1.5rem;color:#4f46e5;margin:0 0 0.5rem;">Rally</h1>
      <p style="color:#525252;margin:0 0 1rem;">Hey${firstName ? ` ${escapeHtml(firstName)}` : ''}! 👋</p>
      <p style="color:#1f2937;margin:0 0 1rem;">It's time to find a date for <strong>${escapeHtml(title)}</strong>${series && series.round > 1 ? ` (round ${series.round})` : ''}. Add the dates that work for you, and vote on the ones already there.</p>
      <div style="background:#f5f3ef;border-radius:12px;padding:1.1rem 1.25rem;margin:1rem 0;">
        <h2 style="font-size:1.15rem;margin:0 0 0.35rem;color:#1a1a1a;">${escapeHtml(title)}</h2>
        ${window ? `<p style="color:#525252;margin:0 0 0.2rem;">🗓️ Looking at ${escapeHtml(window)}</p>` : ''}
        ${event?.location ? `<p style="color:#525252;margin:0;">📍 ${escapeHtml(event.location)}</p>` : ''}
      </div>
      <a href="${escapeHtml(link)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:0.75rem 1.75rem;border-radius:8px;text-decoration:none;font-weight:600;">Suggest dates &amp; vote</a>
      <p style="color:#9ca3af;font-size:0.75rem;margin-top:2rem;">${escapeHtml(from)} set this up to repeat — you'll get one of these each time it's time to plan the next one.</p>
    </div>`;
  return { subject, html, link };
}

// Guests who won't get the poll because there's no address to send it to —
// what the heads-up asks the organizer to fix.
export function guestsWithoutEmail(event) {
  return Object.values(event?.members || {})
    .filter((m) => m && typeof m === 'object' && m.role !== 'owner' && !String(m.email || '').includes('@'))
    .map((m) => m.name || 'Someone');
}

const longDay = (ymdStr) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymdStr || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/* The organizer's heads-up, a week before the guests' email: when it goes,
 * who gets it, who can't, the dates on the poll, and the guests' email itself
 * so there are no surprises. `options` are the round's date options. */
export function ownerPreviewEmail({ event, eventId, options = [], today = '' }) {
  const title = event?.title || 'your event';
  const recipients = pollRecipients(event);
  const missing = guestsWithoutEmail(event);
  const when = longDay(event?.pollSendDate);
  const eventUrl = `${APP_URL}/event/${eventId}`;
  const dates = [...options]
    .filter((o) => o?.startDate)
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))
    .map((o) => (o.endDate && o.endDate !== o.startDate ? `${longDay(o.startDate)} – ${longDay(o.endDate)}` : longDay(o.startDate)));
  const sample = recipients[0] || { key: 'preview', member: { name: 'Sam' } };
  const guestEmail = pollInviteEmail({ event, eventId, key: sample.key, member: sample.member });
  const subject = `Heads up: the ${title} poll goes to ${recipients.length} guest${recipients.length === 1 ? '' : 's'} on ${when}`;
  const li = (s) => `<li style="margin:0 0 0.2rem;">${escapeHtml(s)}</li>`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:2rem;">
      <h1 style="font-size:1.5rem;color:#4f46e5;margin:0 0 0.5rem;">Rally</h1>
      <p style="color:#1f2937;margin:0 0 1rem;">Your date poll for <strong>${escapeHtml(title)}</strong> goes out on <strong>${escapeHtml(when)}</strong>${today && event?.pollSendDate === today ? ' — that’s today' : ''}. Here’s what will happen, with time to change anything first.</p>
      <div style="background:#f5f3ef;border-radius:12px;padding:1rem 1.25rem;margin:0 0 1rem;">
        <p style="margin:0 0 0.4rem;font-weight:700;color:#111827;">Going to ${recipients.length} guest${recipients.length === 1 ? '' : 's'}</p>
        ${recipients.length ? `<ul style="margin:0;padding-left:1.1rem;color:#374151;">${recipients.map((r) => li(`${r.member.name || r.member.email} · ${r.member.email}`)).join('')}</ul>` : '<p style="margin:0;color:#b45309;">Nobody yet — add guests with email addresses on the event.</p>'}
        ${missing.length ? `<p style="margin:0.6rem 0 0;color:#b45309;">⚠ No email address, so they won’t get it: ${escapeHtml(missing.join(', '))}</p>` : ''}
      </div>
      <div style="background:#f5f3ef;border-radius:12px;padding:1rem 1.25rem;margin:0 0 1rem;">
        <p style="margin:0 0 0.4rem;font-weight:700;color:#111827;">Dates on the poll${event?.pollWindow ? ` (${escapeHtml(windowLabel(event.pollWindow))})` : ''}</p>
        ${dates.length ? `<ul style="margin:0;padding-left:1.1rem;color:#374151;">${dates.map(li).join('')}</ul>` : '<p style="margin:0;color:#6b7280;">None yet — guests will be asked to suggest some. You can add dates on the event.</p>'}
      </div>
      <a href="${escapeHtml(eventUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:0.7rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600;">Review the event</a>
      <p style="color:#6b7280;font-size:0.82rem;margin:0.8rem 0 0;">Want it out sooner? Use <em>Send poll now</em> on the event page.</p>
      <p style="margin:1.75rem 0 0.5rem;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:#9ca3af;font-weight:700;">What your guests will get</p>
      <div style="border:1px dashed #d1d5db;border-radius:12px;">${guestEmail.html}</div>
    </div>`;
  return { subject, html, recipients: recipients.length, missing };
}

