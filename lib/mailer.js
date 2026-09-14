// Sending one email, through whichever provider this deployment has.
//
// Gmail first: an account plus an App Password (GMAIL_USER /
// GMAIL_APP_PASSWORD) can mail any address, free, with no sending domain —
// the same setup the Prospect Tracker's digests use. Resend is the fallback,
// and from its shared resend.dev sender it only delivers to the Resend
// account's own address, which is why a second recipient on the wedding
// digest was being refused.
//
// Kept outside api/ so Vercel doesn't route it.
import { senderAddress } from './emailSender.js';

export const gmailConfigured = (env = globalThis.process?.env || {}) => !!(env.GMAIL_USER && env.GMAIL_APP_PASSWORD);
export const mailConfigured = (env = globalThis.process?.env || {}) => gmailConfigured(env) || !!env.RESEND_API_KEY;

/* Send to one address. Never throws: resolves { ok, via, error? } so a caller
 * sending to several people can carry on past a refusal and report it. */
export async function sendOne({ to, subject, html, fromName = 'Rally' }, env = globalThis.process?.env || {}) {
  if (gmailConfigured(env)) {
    try {
      const nm = await import('nodemailer');
      const nodemailer = nm.default || nm;
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        // Google shows App Passwords in groups of four; the spaces aren't part of it.
        auth: { user: env.GMAIL_USER, pass: String(env.GMAIL_APP_PASSWORD).replace(/\s+/g, '') },
      });
      await transporter.sendMail({ from: `${fromName} <${env.GMAIL_USER}>`, to, subject, html });
      return { ok: true, via: 'gmail' };
    } catch (err) {
      return { ok: false, via: 'gmail', error: err.message || 'Gmail send failed' };
    }
  }

  if (!env.RESEND_API_KEY) return { ok: false, via: 'none', error: 'No email provider configured' };
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: senderAddress(fromName, env), to: [to], subject, html }),
    });
    if (response.ok) return { ok: true, via: 'resend' };
    const err = await response.json().catch(() => ({}));
    return { ok: false, via: 'resend', error: err.message || `HTTP ${response.status}` };
  } catch (err) {
    return { ok: false, via: 'resend', error: err.message || 'network error' };
  }
}
