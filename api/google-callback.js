// Handles Google OAuth callback, exchanges code for tokens.
// Web flow: post the tokens back to the opener popup via postMessage.
// Native flow (state=native): the app opened this in the system browser, so
// hand the tokens back by redirecting to the rally:// deep link, which reopens
// the iOS app. (Tokens ride in the URL — acceptable for this personal app.)
function nativePage(params) {
  const deepLink = `rally://google-auth?${new URLSearchParams(params).toString()}`;
  const link = JSON.stringify(deepLink); // safe JS string literal
  const isError = !!params.error;
  // SFSafariViewController (what @capacitor/browser opens on iOS) silently blocks
  // automatic JS redirects to a custom scheme. Fire the auto-redirect anyway, but
  // also render a tappable button — a user tap IS allowed to open rally://.
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Rally</title></head>
<body style="font-family:-apple-system,system-ui,sans-serif;text-align:center;padding:2.5rem 1.5rem;color:#111;background:#fff">
  <h2 style="font-size:1.25rem;margin:0 0 .5rem">${isError ? 'Sign-in failed' : 'Connected!'}</h2>
  <p style="color:#555;margin:0 0 1.5rem">${isError ? 'Return to Rally and try again.' : 'Returning to Rally…'}</p>
  <a href="${deepLink}" style="display:inline-block;padding:.85rem 1.5rem;background:#2563eb;color:#fff;border-radius:12px;text-decoration:none;font-weight:600;font-size:1rem">Return to Rally</a>
  <script>
    function go(){ try { window.location.href = ${link}; } catch (e) {} }
    go();
    setTimeout(go, 400);
  </script>
</body></html>`;
}

export default async function handler(req, res) {
  const { code, error, state } = req.query;
  const isNative = state === 'native';

  if (error || !code) {
    if (isNative) return res.status(200).send(nativePage({ error: error || 'no code' }));
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
      const msg = tokens.error_description || tokens.error;
      if (isNative) return res.status(200).send(nativePage({ error: msg }));
      return res.status(400).send(`<html><body><script>window.opener?.postMessage({type:'google-auth-error',error:'${msg}'},'*');window.close();</script></body></html>`);
    }
    if (isNative) {
      return res.status(200).send(nativePage({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || '',
        expiresIn: String(tokens.expires_in || 3600),
      }));
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
    if (isNative) return res.status(200).send(nativePage({ error: err.message }));
    return res.status(500).send(`<html><body><script>window.opener?.postMessage({type:'google-auth-error',error:'${err.message}'},'*');window.close();</script></body></html>`);
  }
}
