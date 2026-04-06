// Sends reminder emails to event members who haven't responded to the poll
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { recipients, fromName, eventTitle, eventDate, eventLocation, pollLink, reminderNumber } = req.body;
  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: 'No recipients provided' });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return res.status(200).json({ sent: 0, message: 'No email service configured. Share the poll link manually.' });
  }

  const results = [];
  for (const r of recipients) {
    if (!r.email) { results.push({ name: r.name, success: false, error: 'No email' }); continue; }
    try {
      const isSecond = reminderNumber === 2;
      const subject = isSecond
        ? `Final reminder: ${fromName || 'Someone'} needs your vote on ${eventTitle}`
        : `Reminder: ${fromName || 'Someone'} is waiting for your vote on ${eventTitle}`;
      const urgencyText = isSecond
        ? `<p style="color: #dc2626; font-weight: 600;">This is a final reminder — please respond so we can finalize plans!</p>`
        : `<p style="color: #525252;">We haven't heard from you yet. Please take a moment to vote on dates so we can finalize plans.</p>`;

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Rally <noreply@resend.dev>',
          to: [r.email],
          subject,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 2rem;">
              <h1 style="font-size: 1.5rem; color: #4f46e5; margin: 0 0 0.5rem;">Rally</h1>
              <p style="color: #525252; margin: 0 0 1rem;">Hey${r.name ? ` ${r.name}` : ''}! 👋</p>
              ${urgencyText}
              <div style="background: #f5f3ef; border-radius: 12px; padding: 1.5rem; margin: 1rem 0;">
                <h2 style="font-size: 1.2rem; margin: 0 0 0.5rem; color: #1a1a1a;">${eventTitle}</h2>
                ${eventDate ? `<p style="color: #525252; margin: 0 0 0.25rem;">📅 ${eventDate}</p>` : ''}
                ${eventLocation ? `<p style="color: #525252; margin: 0;">📍 ${eventLocation}</p>` : ''}
              </div>
              <a href="${pollLink}" style="display: inline-block; background: #4f46e5; color: #fff; padding: 0.75rem 2rem; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 0.5rem;">Vote Now</a>
              <p style="color: #9ca3af; font-size: 0.75rem; margin-top: 2rem;">If you didn't expect this email, you can safely ignore it.</p>
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
