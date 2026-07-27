// Vercel Cron: runs before dawn (0 8 * * * UTC — 4am ET in summer) and pushes
// each user's outstanding daily reach-out count to their device. iOS sets the
// app-icon badge from the push payload even when the app is closed, so the red
// dot is already waiting each morning whether or not the app is opened. Mirrors
// the in-app unmetCount() logic in src/hooks/useReachOutBadge.js.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import http2 from 'node:http2';
import crypto from 'node:crypto';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) {
    initializeApp({ credential: cert(sa) });
  }
}

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

// Token-based APNs auth: a short-lived ES256 JWT signed with the .p8 key,
// reusable across every request in this run (APNs allows up to 1 hour).
function apnsJwt({ keyId, teamId, privateKey }) {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const iat = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iss: teamId, iat }));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363', // raw r||s, as ES256 JWT requires
  });
  return `${signingInput}.${b64url(signature)}`;
}

// Local calendar date (YYYY-MM-DD) in a given IANA timezone — the cron runs in
// UTC, but "today" for reach-outs is the user's local day (ET).
function dateKeyInTz(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// How many of today's two goals (one family, one friend) are still outstanding:
// 0, 1, or 2. Kept in sync with useReachOutBadge.js.
function unmetCount(reachOuts, todayK) {
  const list = Array.isArray(reachOuts) ? reachOuts : [];
  const reachedToday = (match) => list.some((c) => c.lastReachOut === todayK && match(c.category || ''));
  const family = reachedToday((cat) => cat === 'Family');
  const friend = reachedToday((cat) => /friend/i.test(cat));
  return (family ? 0 : 1) + (friend ? 0 : 1);
}

// Send one push over the shared HTTP/2 connection. Resolves { status, reason }.
function sendApns(client, { token, jwt, bundleId, payload, pushType, priority }) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload));
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': pushType,
      'apns-priority': priority,
      'content-type': 'application/json',
      'content-length': body.length,
    });
    let status = 0;
    let data = '';
    req.on('response', (headers) => { status = headers[':status']; });
    req.setEncoding('utf8');
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      let reason = '';
      try { reason = data ? (JSON.parse(data).reason || '') : ''; } catch { /* non-JSON */ }
      resolve({ status, reason });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export default async function handler(req, res) {
  // GET = Vercel Cron; POST = manual trigger.
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const bundleId = process.env.APNS_BUNDLE_ID;
  const privateKey = (process.env.APNS_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!keyId || !teamId || !bundleId || !privateKey) {
    return res.status(200).json({
      skipped: true,
      reason: 'APNs not configured. Set APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_PRIVATE_KEY.',
    });
  }

  let db;
  try {
    db = getFirestore();
  } catch {
    return res.status(200).json({ skipped: true, reason: 'Firebase Admin not configured. Set FIREBASE_SERVICE_ACCOUNT.' });
  }

  // A device token belongs to exactly one APNs environment, and which one you get
  // depends on how the app was installed — a TestFlight or App Store build is
  // production, a build run from Xcode is sandbox. Guessing wrong earns a 403
  // (BadEnvironmentKeyInToken / BadDeviceToken) rather than a delivery, so try
  // the expected environment first and fall back to the other. APNS_PRODUCTION
  // only picks which one is tried first.
  const HOSTS = { production: 'api.push.apple.com', sandbox: 'api.sandbox.push.apple.com' };
  const primaryEnv = process.env.APNS_PRODUCTION === 'false' ? 'sandbox' : 'production';
  const otherEnv = primaryEnv === 'production' ? 'sandbox' : 'production';
  const clients = {};
  const clientFor = (env) => (clients[env] ||= http2.connect(`https://${HOSTS[env]}`));

  // Worth retrying on the other host: both mean "this token isn't from here".
  const WRONG_ENV = new Set(['BadDeviceToken', 'BadEnvironmentKeyInToken']);
  const closeAll = () => { for (const c of Object.values(clients)) c.close(); };

  const todayK = dateKeyInTz('America/New_York');
  const jwt = apnsJwt({ keyId, teamId, privateKey });

  const results = [];
  const staleByUser = {}; // uid -> [tokens APNs rejected as unregistered]

  try {
    const usersSnap = await db.collection('users').get();

    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      const tokenMap = data.pushTokens && typeof data.pushTokens === 'object' ? data.pushTokens : null;
      const tokens = tokenMap ? Object.keys(tokenMap) : [];
      if (tokens.length === 0) continue;

      const count = unmetCount(data.reachOuts, todayK);

      // Badge only — no alert body, no sound. This runs before dawn so the dots
      // are already waiting when the phone is first picked up, and a banner that
      // woke someone at 4am would be worse than no reminder at all. A badge-only
      // push is still push-type "alert" (it changes what the user sees); only the
      // zero case is a true background push.
      const payload = count > 0
        ? { aps: { badge: count } }
        : { aps: { badge: 0, 'content-available': 1 } };
      const pushType = count > 0 ? 'alert' : 'background';
      const priority = count > 0 ? '10' : '5';

      for (const token of tokens) {
        try {
          const send = (env) => sendApns(clientFor(env), { token, jwt, bundleId, payload, pushType, priority });

          let env = primaryEnv;
          let { status, reason } = await send(env);
          // Wrong environment for this token — try the other one before writing
          // it off, so TestFlight and Xcode installs both work without config.
          let alt = null;
          if (status !== 200 && WRONG_ENV.has(reason)) {
            const retry = await send(otherEnv);
            // Reported either way: when both environments refuse a token the
            // reason from each is the only thing that says why.
            alt = { env: otherEnv, status: retry.status, reason: retry.reason || '' };
            if (retry.status === 200 || !WRONG_ENV.has(retry.reason)) {
              ({ status, reason } = retry);
              env = otherEnv;
              alt = null;
            }
          }

          const ok = status === 200;
          results.push({ uid: userDoc.id, token: token.slice(0, 8), count, status, ok, env, ...(reason ? { reason } : {}), ...(alt ? { alt } : {}) });
          // Dead token — gone from the device, or rejected by both environments.
          if (status === 410 || reason === 'Unregistered' || reason === 'BadDeviceToken') {
            (staleByUser[userDoc.id] ||= []).push(token);
          }
        } catch (err) {
          results.push({ uid: userDoc.id, token: token.slice(0, 8), ok: false, error: err.message });
        }
      }
    }
  } catch (err) {
    closeAll();
    return res.status(500).json({ error: err.message });
  }

  closeAll();

  // Drop tokens APNs rejected so we stop pushing to dead devices.
  for (const [uid, toks] of Object.entries(staleByUser)) {
    const patch = {};
    for (const t of toks) patch[`pushTokens.${t}`] = FieldValue.delete();
    try { await db.collection('users').doc(uid).update(patch); } catch { /* best-effort */ }
  }

  const sent = results.filter((r) => r.ok).length;
  return res.status(200).json({ ran: true, today: todayK, sent, total: results.length, results });
}
