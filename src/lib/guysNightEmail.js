// The steakhouse list as an email to everyone on the event.
// Pure: the API passes in the event and the summary from guysNight.js.
import { formatGuysNightDate, spotLink } from './guysNight.js';
import { APP_URL } from './pollSeriesEmail.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Everyone on the event with an email address, the organizer included (they
// get the same email, so they know what went out). Hidden-from people are
// skipped, as the poll emails skip them.
export function steakhouseRecipients(event) {
  const hidden = new Set((Array.isArray(event?.hiddenFrom) ? event.hiddenFrom : []).map((e) => String(e || '').trim().toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const [key, m] of Object.entries(event?.members || {})) {
    if (!m || typeof m !== 'object') continue;
    const email = String(m.email || '').trim().toLowerCase();
    if (!email || !email.includes('@') || hidden.has(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ key, member: m, email });
  }
  return out;
}

function spotRow(s, { done }) {
  const link = spotLink(s);
  const name = link
    ? `<a href="${esc(link)}" style="color:#7c2d12;text-decoration:none;font-weight:650;">${esc(s.name)}</a>`
    : `<strong style="color:#7c2d12;">${esc(s.name)}</strong>`;
  const tags = [];
  if (s.next) tags.push('<span style="color:#b45309;font-weight:700;">★ Next</span>');
  if (!done) tags.push(s.visited ? 'Been before' : 'Never been');
  if (s.area) tags.push(esc(s.area));
  const detail = [
    done && s.dates.length ? `Went ${s.dates.map(formatGuysNightDate).map(esc).join(', ')}` : '',
    s.address ? esc(s.address) : '',
    s.dish ? `Get: ${esc(s.dish)}` : '',
  ].filter(Boolean);
  return `<tr><td style="padding:0.45rem 0;border-bottom:1px solid #f1e7dd;font-size:0.9rem;line-height:1.45;">
    ${done ? '&#10003; ' : ''}${name}${tags.length ? ` <span style="color:#78716c;font-size:0.8rem;">· ${tags.join(' · ')}</span>` : ''}
    ${detail.length ? `<div style="color:#57534e;font-size:0.8rem;">${detail.join(' · ')}</div>` : ''}
  </td></tr>`;
}

export function steakhouseEmail({ event, eventId, summary, member, fromName = 'Dan' }) {
  const title = event?.title || 'Steak Night';
  const firstName = String(member?.name || '').trim().split(/\s+/)[0];
  const subject = `🥩 ${title}: the steakhouse list — ${summary.doneCount} of ${summary.total} done`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:1.5rem;color:#1c1917;">
      <h1 style="font-size:1.35rem;margin:0 0 0.25rem;">🥩 ${esc(title)}</h1>
      <p style="color:#57534e;margin:0 0 1rem;">Hey${firstName ? ` ${esc(firstName)}` : ''} — here's where the steakhouse tour stands: <strong>${summary.doneCount} of ${summary.total} done</strong>.</p>
      ${summary.todo.length ? `
      <h2 style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.05em;color:#9a3412;margin:1.1rem 0 0.2rem;">Still to go (${summary.todo.length})</h2>
      <table role="presentation" style="width:100%;border-collapse:collapse;">${summary.todo.map((s) => spotRow(s, { done: false })).join('')}</table>` : '<p style="color:#166534;font-weight:650;">Every steakhouse on the list is done.</p>'}
      ${summary.done.length ? `
      <h2 style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.05em;color:#166534;margin:1.25rem 0 0.2rem;">Done (${summary.done.length})</h2>
      <table role="presentation" style="width:100%;border-collapse:collapse;">${summary.done.map((s) => spotRow(s, { done: true })).join('')}</table>` : ''}
      <p style="margin:1.5rem 0 0;"><a href="${esc(`${APP_URL}/event/${eventId}`)}" style="display:inline-block;background:#9a3412;color:#fff;padding:0.65rem 1.4rem;border-radius:8px;text-decoration:none;font-weight:600;">Open ${esc(title)} in Rally</a></p>
      <p style="color:#a8a29e;font-size:0.75rem;margin:1.25rem 0 0;">Sent by ${esc(fromName)} from Rally.</p>
    </div>`;
  return { subject, html };
}
