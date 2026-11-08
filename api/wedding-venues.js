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
// The Gmail refresh token never reaches the browser: it lives in
// weddingGmailTokens/{uid}, a collection with no Firestore rule, so only this
// server (Admin SDK) can read it. The user doc only says which inbox is linked.
import { randomBytes } from 'node:crypto';
import { getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { refreshAccessToken, scanInbox } from '../lib/weddingVenueScan.js';
import { GMAIL_SCOPE } from '../lib/weddingGmailAuth.js';

export const config = { maxDuration: 300 };

const origin = (req) => `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!getApps().length) return res.status(500).json({ error: 'Server is missing FIREBASE_SERVICE_ACCOUNT' });

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
    const snap = await tokenRef.get();
    const stored = snap.data();
    if (!stored?.refreshToken) return res.status(409).json({ error: 'Connect a Gmail inbox first', code: 'not_connected' });
    let access;
    try {
      access = await refreshAccessToken(stored.refreshToken);
    } catch (err) {
      if (err.code === 'invalid_grant') {
        // Revoked, or expired (Google expires them after 7 days while the
        // OAuth app is in Testing). Forget it so the page offers Connect again.
        await tokenRef.delete().catch(() => {});
        await userRef.set({ weddingGmail: FieldValue.delete() }, { merge: true });
        return res.status(409).json({ error: 'The Gmail connection expired — connect it again', code: 'not_connected' });
      }
      return res.status(502).json({ error: `Google sign-in failed: ${err.message}` });
    }
    const userSnap = await userRef.get();
    const last = userSnap.data()?.weddingGmail?.lastScanAt;
    const since = !full && last?.toDate ? last.toDate() : null;
    try {
      const { venues, threadCount } = await scanInbox(access, { since });
      await userRef.set({ weddingGmail: { lastScanAt: FieldValue.serverTimestamp() } }, { merge: true });
      return res.status(200).json({ venues, threadCount, account: stored.email || '', since: since ? since.toISOString() : null });
    } catch (err) {
      if (err.status === 403) {
        return res.status(502).json({ error: 'Gmail refused the request — is the Gmail API enabled for this Google Cloud project?' });
      }
      return res.status(500).json({ error: err.message || 'Scan failed' });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
