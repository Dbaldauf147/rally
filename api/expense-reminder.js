/* global process */
// Emails someone what they still owe on a split expense.
//
// Only ever sent by an explicit click in the app — there is no cron here on
// purpose. A ledger that nags your friends on a schedule without you deciding
// to is a good way to lose both. The caller supplies the recipients and the
// figures; this route's job is the email itself.
//
// Requires a signed-in Rally user, so knowing the URL isn't enough to send
// mail from this domain to anyone you like.
//
//   RESEND_API_KEY            same key the invite and poll reminders use
//   FIREBASE_SERVICE_ACCOUNT  Rally's own, for verifying the caller
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const MAX_RECIPIENTS = 20;

function rallyApp() {
  if (!getApps().some(a => a.name === '[DEFAULT]')) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (!sa.project_id) return null;
    initializeApp({ credential: cert(sa) });
  }
  return getApp();
}

// Anything interpolated into the email body is a name or a note someone typed
// into Rally, so it gets escaped rather than trusted as markup.
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const usd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
  .format(Number(n) || 0);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { recipients, expenseTitle, eventTitle, fromName, note } = req.body || {};
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: 'No recipients provided' });
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return res.status(400).json({ error: `At most ${MAX_RECIPIENTS} recipients per request` });
  }

  const app = rallyApp();
  if (!app) return res.status(500).json({ error: 'Rally credentials are not configured' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    await getAuth(app).verifyIdToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return res.status(200).json({ sent: 0, skipped: true, reason: 'No email service configured' });
  }

  const from = esc(fromName || 'Someone');
  const what = esc(expenseTitle || 'a shared expense');
  const where = eventTitle ? ` for ${esc(eventTitle)}` : '';
  const results = [];

  for (const r of recipients) {
    if (!r?.email) { results.push({ name: r?.name, success: false, error: 'No email on file' }); continue; }
    const amount = Number(r.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      results.push({ name: r.name, success: false, error: 'Nothing outstanding' });
      continue;
    }
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Rally <noreply@resend.dev>',
          to: [r.email],
          subject: `${from} split ${what}${where} — your share is ${usd(amount)}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 2rem;">
              <h1 style="font-size: 1.5rem; color: #4f46e5; margin: 0 0 0.5rem;">Rally</h1>
              <p style="color: #525252; margin: 0 0 1rem;">Hey${r.name ? ` ${esc(r.name)}` : ''}! 👋</p>
              <p style="color: #525252; margin: 0 0 1rem;">${from} covered ${what}${where} and split it up.</p>
              <div style="background: #f5f3ef; border-radius: 12px; padding: 1.5rem; margin: 1rem 0;">
                <div style="font-size: 0.85rem; color: #737373; text-transform: uppercase; letter-spacing: 0.05em;">Your share</div>
                <div style="font-size: 2rem; font-weight: 700; color: #1a1a1a;">${usd(amount)}</div>
                ${r.paid > 0 ? `<div style="color: #525252; margin-top: 0.5rem;">${usd(r.paid)} already received — thank you!</div>` : ''}
              </div>
              ${note ? `<p style="color: #525252;">${esc(note)}</p>` : ''}
              <p style="color: #9ca3af; font-size: 0.75rem; margin-top: 2rem;">Sent from Rally because ${from} split an expense with you.</p>
            </div>
          `,
        }),
      });
      if (response.ok) {
        results.push({ name: r.name, email: r.email, success: true });
      } else {
        const err = await response.json().catch(() => ({}));
        results.push({ name: r.name, email: r.email, success: false, error: err.message || `HTTP ${response.status}` });
      }
    } catch (err) {
      results.push({ name: r.name, email: r.email, success: false, error: err.message });
    }
  }

  const sent = results.filter(r => r.success).length;
  return res.status(200).json({ sent, total: recipients.length, results });
}
