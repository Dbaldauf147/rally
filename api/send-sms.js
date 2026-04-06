// Sends SMS via Twilio
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { to, message } = req.body;
  if (!to || !message) return res.status(400).json({ error: 'Missing to or message' });

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    return res.status(500).json({ error: 'Twilio not configured' });
  }

  // Send to multiple numbers
  const numbers = Array.isArray(to) ? to : [to];
  const results = [];

  for (const number of numbers) {
    // Clean phone number — add +1 if no country code
    let cleaned = number.replace(/[^+\d]/g, '');
    if (!cleaned.startsWith('+')) {
      cleaned = cleaned.startsWith('1') ? `+${cleaned}` : `+1${cleaned}`;
    }

    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: cleaned, From: from, Body: message }),
        }
      );

      const data = await response.json();
      if (data.sid) {
        results.push({ to: cleaned, success: true });
      } else {
        results.push({ to: cleaned, success: false, error: data.message || 'Failed' });
      }
    } catch (err) {
      results.push({ to: cleaned, success: false, error: err.message });
    }
  }

  const sent = results.filter(r => r.success).length;
  return res.json({ sent, total: numbers.length, results });
}
