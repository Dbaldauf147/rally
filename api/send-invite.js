export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { to, fromName, eventTitle, eventDate, eventLocation, inviteLink } = req.body;
  if (!to || !inviteLink) return res.status(400).json({ error: 'Missing required fields' });

  // Use Resend API if key is set, otherwise return the link for manual sharing
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return res.status(200).json({ sent: false, link: inviteLink, message: 'No email service configured. Share this link manually.' });
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Rally <noreply@resend.dev>',
        to: [to],
        subject: `${fromName || 'Someone'} invited you to: ${eventTitle}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 2rem;">
            <h1 style="font-size: 1.5rem; color: #4f46e5; margin: 0 0 0.5rem;">Rally</h1>
            <p style="color: #525252; margin: 0 0 1.5rem;">You're invited to an event!</p>
            <div style="background: #f5f3ef; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem;">
              <h2 style="font-size: 1.2rem; margin: 0 0 0.5rem; color: #1a1a1a;">${eventTitle}</h2>
              ${eventDate ? `<p style="color: #525252; margin: 0 0 0.25rem;">📅 ${eventDate}</p>` : ''}
              ${eventLocation ? `<p style="color: #525252; margin: 0;">📍 ${eventLocation}</p>` : ''}
            </div>
            <p style="color: #525252; margin: 0 0 1rem;">${fromName || 'A friend'} wants you to join this event on Rally.</p>
            <a href="${inviteLink}" style="display: inline-block; background: #4f46e5; color: #fff; padding: 0.75rem 2rem; border-radius: 8px; text-decoration: none; font-weight: 600;">View Event & RSVP</a>
            <p style="color: #9ca3af; font-size: 0.75rem; margin-top: 2rem;">If you didn't expect this email, you can safely ignore it.</p>
          </div>
        `,
      }),
    });

    if (response.ok) {
      return res.status(200).json({ sent: true });
    } else {
      const err = await response.json();
      return res.status(500).json({ sent: false, error: err.message || 'Failed to send email' });
    }
  } catch (err) {
    return res.status(500).json({ sent: false, error: err.message });
  }
}
