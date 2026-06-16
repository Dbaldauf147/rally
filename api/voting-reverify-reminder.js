// Vercel Cron: emails an annual early-October reminder to re-verify the
// curated state voting dates (src/electionDates.js) against official sources
// before that fall's election — registration deadlines fall in late October.
// Uses Resend, mirroring weekly-digest.js.

const DEFAULT_RECIPIENT = 'baldaufdan@gmail.com';
const APP_URL = 'https://rally-seven-theta.vercel.app';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return res.status(200).json({ skipped: true, reason: 'No RESEND_API_KEY configured' });
  }

  const base = (process.env.VOTING_REMINDER_EMAIL || process.env.DIGEST_RECIPIENT_EMAIL || DEFAULT_RECIPIENT).toLowerCase();
  const toOverride = (req.query?.to || '').toString().trim().toLowerCase();
  const recipient = toOverride || base;

  const year = new Date().getFullYear();
  const subject = `Re-verify your voting dates before the ${year} election`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; padding: 2rem;">
      <h1 style="font-size: 1.4rem; color: #4f46e5; margin: 0 0 0.5rem;">🗳️ Time to re-verify your voting dates</h1>
      <p style="color: #374151; line-height: 1.55; margin: 0 0 1rem;">
        This is your automated early-October reminder. Election dates and deadlines change year to year,
        so before this fall's election, please confirm the saved dates on your Rally Voting page against
        the official sources — the voter <strong>registration deadline and early-voting window typically fall
        in late October</strong>, with Election Day on the first Tuesday after the first Monday in November.
      </p>
      <p style="color: #374151; line-height: 1.55; margin: 0 0 1rem;">
        Open the Voting page, check each curated date, and re-confirm it against your state's board of elections.
        For New York: confirm the registration deadline, early-voting dates, and absentee deadlines.
      </p>
      <div style="margin: 1.25rem 0;">
        <a href="${APP_URL}/voting" style="display: inline-block; background: #4f46e5; color: #fff; padding: 0.6rem 1.25rem; border-radius: 8px; text-decoration: none; font-weight: 600;">Open the Voting page</a>
      </div>
      <p style="color: #374151; line-height: 1.55; margin: 0 0 0.5rem;"><strong>Official sources:</strong></p>
      <ul style="color: #374151; line-height: 1.6; margin: 0 0 1rem; padding-left: 1.1rem;">
        <li><a href="https://elections.ny.gov/registration-and-voting-deadlines" style="color:#4f46e5;">NY State Board of Elections — deadlines</a></li>
        <li><a href="https://www.vote.nyc/elections" style="color:#4f46e5;">NYC Board of Elections — elections</a></li>
        <li><a href="https://vote.gov" style="color:#4f46e5;">vote.gov</a></li>
      </ul>
      <p style="color: #9ca3af; font-size: 0.75rem; margin-top: 2rem;">Automated annual reminder from Rally. Reply to stop.</p>
    </div>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Rally <noreply@resend.dev>', to: [recipient], subject, html }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ sent: false, error: err.message || `HTTP ${response.status}` });
    }
    return res.status(200).json({ sent: true, recipient });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
