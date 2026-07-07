// Redirects user to Google OAuth for Calendar access.
// ?platform=native rides through as OAuth `state` so the callback knows to hand
// tokens back to the iOS app via the rally:// deep link instead of postMessage.
export default function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/google-callback`;
  const scope = encodeURIComponent('https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events');
  const state = req.query.platform === 'native' ? 'native' : 'web';
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${state}`;
  res.redirect(302, url);
}
