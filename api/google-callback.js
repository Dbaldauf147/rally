// Handles Google OAuth callback, exchanges code for tokens
export default async function handler(req, res) {
  const { code, error } = req.query;
  if (error || !code) {
    return res.status(400).send(`<html><body><script>window.opener?.postMessage({type:'google-auth-error',error:'${error || 'no code'}'},'*');window.close();</script></body></html>`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/google-callback`;

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) {
      return res.status(400).send(`<html><body><script>window.opener?.postMessage({type:'google-auth-error',error:'${tokens.error_description || tokens.error}'},'*');window.close();</script></body></html>`);
    }
    return res.status(200).send(`<html><body><script>
      window.opener?.postMessage({
        type:'google-auth-success',
        accessToken:'${tokens.access_token}',
        refreshToken:'${tokens.refresh_token || ''}',
        expiresIn:${tokens.expires_in || 3600}
      },'*');window.close();
    </script><p>Connected! You can close this window.</p></body></html>`);
  } catch (err) {
    return res.status(500).send(`<html><body><script>window.opener?.postMessage({type:'google-auth-error',error:'${err.message}'},'*');window.close();</script></body></html>`);
  }
}
