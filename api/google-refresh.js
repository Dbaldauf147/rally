// Refreshes an expired Google OAuth access token using a refresh token
export default async function handler(req, res) {
  const { refreshToken } = req.query;
  if (!refreshToken) return res.status(400).json({ error: 'Missing refreshToken' });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) {
      return res.status(400).json({ error: tokens.error_description || tokens.error });
    }
    return res.json({
      accessToken: tokens.access_token,
      expiresIn: tokens.expires_in || 3600,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
