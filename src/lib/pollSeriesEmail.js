// The email a poll-series round sends on its send date: "time to pick a date
// for <event> — suggest dates and vote". One per guest, each with their own
// poll link. Pure, so the wording and the recipient rules can be tested; the
// sending is api/poll-series.js's.

import { normalizePollSeries, windowLabel } from './pollSeries.js';

export const APP_URL = 'https://rally-seven-theta.vercel.app';

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Who gets it: every guest with an email address — the owner included, as
 * their copy of what went out — except anyone the event is hidden from (a
 * surprise stays a surprise). One email per address. [{ key, member }]. */
export function pollRecipients(event) {
  const hidden = new Set((Array.isArray(event?.hiddenFrom) ? event.hiddenFrom : []).map((e) => String(e || '').trim().toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const [key, m] of Object.entries(event?.members || {})) {
    if (!m || typeof m !== 'object') continue;
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
