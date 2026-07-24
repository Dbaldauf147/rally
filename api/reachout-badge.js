// Vercel Cron: runs every morning and pushes each user's outstanding daily
// reach-out count to their device as an APNs notification. iOS sets the app-icon
// badge from the push payload even when the app is closed, so the red dot is
// reliable each day whether or not the app is opened. Mirrors the in-app
// unmetCount() logic in src/hooks/useReachOutBadge.js.
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

  // App Store / TestFlight builds use the production APNs host. Set
  // APNS_PRODUCTION=false only when testing a debug build from Xcode.
  const host = process.env.APNS_PRODUCTION === 'false' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const todayK = dateKeyInTz('America/New_York');
  const jwt = apnsJwt({ keyId, teamId, privateKey });

  const client = http2.connect(`https://${host}`);
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

      // A visible nudge when something is outstanding (reliable delivery, and it
      // doubles as the daily reminder); a silent badge-clear otherwise.
      const payload = count > 0
        ? {
            aps: {
              alert: {
                title: 'Reach Out',
                body: `You have ${count} ${count === 1 ? 'person' : 'people'} to reach out to today.`,
              },
              badge: count,
              sound: 'default',
            },
          }
        : { aps: { badge: 0, 'content-available': 1 } };
      const pushType = count > 0 ? 'alert' : 'background';
      const priority = count > 0 ? '10' : '5';

      for (const token of tokens) {
        try {
          const { status, reason } = await sendApns(client, { token, jwt, bundleId, payload, pushType, priority });
          const ok = status === 200;
          results.push({ uid: userDoc.id, token: token.slice(0, 8), count, status, ok, ...(reason ? { reason } : {}) });
          // BadDeviceToken / Unregistered → the token is dead; prune it.
          if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') {
            (staleByUser[userDoc.id] ||= []).push(token);
          }
        } catch (err) {
          results.push({ uid: userDoc.id, token: token.slice(0, 8), ok: false, error: err.message });
        }
      }
    }
  } catch (err) {
    client.close();
    return res.status(500).json({ error: err.message });
  }

  client.close();

  // Drop tokens APNs rejected so we stop pushing to dead devices.
  for (const [uid, toks] of Object.entries(staleByUser)) {
    const patch = {};
    for (const t of toks) patch[`pushTokens.${t}`] = FieldValue.delete();
    try { await db.collection('users').doc(uid).update(patch); } catch { /* best-effort */ }
  }

  const sent = results.filter((r) => r.ok).length;
  return res.status(200).json({ ran: true, today: todayK, sent, total: results.length, results });
}
