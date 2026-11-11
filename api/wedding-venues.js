/* global process */
// Wedding venues from Gmail. POST with the signed-in user's Firebase ID token
// (Authorization: Bearer …) and { action }:
//
//   connect     → { url }: Google's consent page for read-only Gmail access.
//                 The sign-in comes back through /api/google-callback (the
//                 redirect URI the Calendar connection already registered),
//                 which recognises it by its `gmail.<nonce>` state.
//   scan        → { venues, threadCount, account }: reads the venue threads
//                 since the last scan (or two years, with { full: true }).
//   disconnect  → revokes the token and forgets the connection.
//
// GET is the daily scheduled scan (Vercel Cron, see vercel.json): every
// linked inbox whose `weddingGmail.autoScan` isn't switched off is scanned at
// 9 AM Eastern, and what it finds is folded into the saved venue list here on
// the server — the same merge the page does after a manual scan.
//
// The Gmail refresh token never reaches the browser: it lives in
// weddingGmailTokens/{uid}, a collection with no Firestore rule, so only this
// server (Admin SDK) can read it. The user doc only says which inbox is linked.
import { randomBytes } from 'node:crypto';
import { getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { refreshAccessToken, scanInbox } from '../lib/weddingVenueScan.js';
import { GMAIL_SCOPE } from '../lib/weddingGmailAuth.js';
import { mergeScannedVenues, normalizeVenue } from '../src/lib/weddingVenues.js';

export const config = { maxDuration: 300 };

/* When the daily scan runs: 9 AM in the inbox's timezone (Eastern unless one
   was saved). A cron runs at a fixed UTC hour and 9 AM Eastern is 13:00 UTC
   in summer and 14:00 in winter, so vercel.json fires at both and whichever
   run first finds it 9 o'clock or later scans; the other finds today done. */
export const AUTO_SCAN_HOUR = 9;
const TZ = 'America/New_York';
function localParts(date, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23',
    }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
  } catch {
    return { day: date.toISOString().slice(0, 10), hour: date.getUTCHours() };
  }
}
export function isAutoScanDue(gmail, now = new Date()) {
  if (!gmail?.email || gmail.autoScan === false) return false;
  const { day, hour } = localParts(now, gmail.timezone);
  return hour >= AUTO_SCAN_HOUR && gmail.lastAutoScanDate !== day;
}

/* One inbox's scan: refresh the token, read mail since the last scan, and
   stamp the scan time. Returns { venues, threadCount, account, since } or
   throws an error with .status (and .code 'not_connected'). */
async function scanFor(db, uid, { full = false } = {}) {
  const tokenRef = db.doc(`weddingGmailTokens/${uid}`);
  const userRef = db.doc(`users/${uid}`);
  const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
  const stored = (await tokenRef.get()).data();
  if (!stored?.refreshToken) throw fail(409, 'Connect a Gmail inbox first', 'not_connected');
  let access;
  try {
    access = await refreshAccessToken(stored.refreshToken);
  } catch (err) {
    if (err.code === 'invalid_grant') {
      // Revoked, or expired (Google expires them after 7 days while the
      // OAuth app is in Testing). Forget it so the page offers Connect again.
      await tokenRef.delete().catch(() => {});
      await userRef.set({ weddingGmail: FieldValue.delete() }, { merge: true });
      throw fail(409, 'The Gmail connection expired — connect it again', 'not_connected');
    }
    throw fail(502, `Google sign-in failed: ${err.message}`);
  }
  const userSnap = await userRef.get();
  const last = userSnap.data()?.weddingGmail?.lastScanAt;
  const since = !full && last?.toDate ? last.toDate() : null;
  try {
    const { venues, threadCount } = await scanInbox(access, { since });
    await userRef.set({ weddingGmail: { lastScanAt: FieldValue.serverTimestamp() } }, { merge: true });
    return { venues, threadCount, account: stored.email || '', since: since ? since.toISOString() : null };
  } catch (err) {
    if (err.status === 403) throw fail(502, 'Gmail refused the request — is the Gmail API enabled for this Google Cloud project?');
    throw fail(500, err.message || 'Scan failed');
  }
}

async function scheduledScan(req, res, db, now = new Date()) {
  // Vercel sends the project's CRON_SECRET as a bearer token when one is set.
  const secret = process.env.CRON_SECRET;
  if (secret && String(req.headers.authorization || '') !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const users = await db.collection('users').get();
  const results = [];
  for (const userDoc of users.docs) {
    const data = userDoc.data() || {};
    if (!isAutoScanDue(data.weddingGmail, now)) continue;
    const uid = userDoc.id;
    const userRef = db.doc(`users/${uid}`);
    const { day } = localParts(now, data.weddingGmail.timezone);
    // Marked first, so a scan that dies half-way isn't retried all afternoon.
    await userRef.set({ weddingGmail: { lastAutoScanDate: day } }, { merge: true });
    try {
      const scan = await scanFor(db, uid);
      // Re-read: the scan takes a while and the page may have saved meanwhile.
      const fresh = (await userRef.get()).data() || {};
      const existing = Array.isArray(fresh.weddingVenues) ? fresh.weddingVenues.map((v) => normalizeVenue(v)) : [];
      const { list, added, updated } = mergeScannedVenues(existing, scan.venues, fresh.weddingVenueDismissed || []);
      const summary = { day, threadCount: scan.threadCount, added, updatedCount: updated.length, at: now.toISOString() };
      await userRef.set({
        ...(added.length || updated.length ? { weddingVenues: list } : {}),
        weddingGmail: { lastAutoScan: summary },
      }, { merge: true });
      results.push({ uid, ...summary });
    } catch (err) {
      await userRef.set({ weddingGmail: { lastAutoScan: { day, error: err.message, at: now.toISOString() } } }, { merge: true }).catch(() => {});
      results.push({ uid, error: err.message });
    }
  }
  return res.status(200).json({ scanned: results.length, results });
}

const origin = (req) => `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!getApps().length) return res.status(500).json({ error: 'Server is missing FIREBASE_SERVICE_ACCOUNT' });
  if (req.method === 'GET') return scheduledScan(req, res, getFirestore());

  let uid;
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    uid = (await getAuth().verifyIdToken(token)).uid;
  } catch {
    return res.status(401).json({ error: 'Sign in again' });
  }

  const db = getFirestore();
  const { action, loginHint, full } = req.body || {};
  const tokenRef = db.doc(`weddingGmailTokens/${uid}`);
  const userRef = db.doc(`users/${uid}`);

  if (action === 'connect') {
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Server is missing GOOGLE_CLIENT_ID' });
    const nonce = randomBytes(18).toString('hex');
    await db.doc(`weddingGmailOAuth/${nonce}`).set({ uid, createdAt: FieldValue.serverTimestamp() });
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: `${origin(req)}/api/google-callback`,
      response_type: 'code',
      scope: GMAIL_SCOPE,
      access_type: 'offline',
      prompt: 'consent select_account',
      include_granted_scopes: 'false',
      state: `gmail.${nonce}`,
    });
    if (loginHint) params.set('login_hint', String(loginHint));
    return res.status(200).json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  }

  if (action === 'disconnect') {
    const snap = await tokenRef.get();
    const refreshToken = snap.data()?.refreshToken;
    if (refreshToken) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' }).catch(() => {});
    }
    await tokenRef.delete().catch(() => {});
    await userRef.set({ weddingGmail: FieldValue.delete() }, { merge: true });
    return res.status(200).json({ ok: true });
  }

  if (action === 'scan') {
    try {
      return res.status(200).json(await scanFor(db, uid, { full }));
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
