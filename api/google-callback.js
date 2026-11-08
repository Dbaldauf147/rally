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

  // The Wedding Venues tab's Gmail sign-in rides on this same redirect URI,
  // marked by a `gmail.<nonce>` state. Its token stays on the server
  // (lib/weddingGmailAuth.js); the page only hears which inbox was linked.
  if (typeof state === 'string' && state.startsWith('gmail.')) {
    return gmailConnectPage(req, res, { code, error, nonce: state.slice('gmail.'.length) });
  }

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

async function gmailConnectPage(req, res, { code, error, nonce }) {
  const reply = (payload) => {
    // Escaped so an error message can't close the <script> it's written into.
    const data = JSON.stringify(payload).replace(/</g, '\\u003c');
    const ok = payload.type === 'gmail-connected';
    res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Rally</title></head>
<body style="font-family:-apple-system,system-ui,sans-serif;text-align:center;padding:2.5rem 1.5rem;color:#111">
<h2 style="font-size:1.2rem">${ok ? 'Gmail connected' : 'Could not connect Gmail'}</h2>
<p style="color:#555">${ok ? 'You can close this window.' : 'Close this window and try again from the Venues tab.'}</p>
<script>try { window.opener && window.opener.postMessage(${data}, location.origin); } catch (e) {} setTimeout(function(){ window.close(); }, ${ok ? 300 : 4000});</script>
</body></html>`);
  };
  if (error || !code) return reply({ type: 'gmail-error', error: error || 'No code returned' });
  try {
    const { finishGmailConnect } = await import('../lib/weddingGmailAuth.js');
    const redirectUri = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/google-callback`;
    const { email } = await finishGmailConnect({ nonce, code, redirectUri });
    return reply({ type: 'gmail-connected', email });
  } catch (err) {
    return reply({ type: 'gmail-error', error: err.message || 'Sign-in failed' });
  }
}
