/* global process */
// The server half of linking a Gmail inbox to the Wedding Venues tab, shared
// by api/wedding-venues.js (which starts the sign-in) and api/google-callback.js
// (where Google sends it back). Kept outside api/ so Vercel doesn't route it.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) initializeApp({ credential: cert(sa) });
}

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
// Writing drafts (never sending: the venue replies wait in Gmail's Drafts for
// a person to send). Asked for alongside reading; a connection without it
// still scans, and the page offers to reconnect when a draft is wanted.
export const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
export const GMAIL_SCOPES = `${GMAIL_SCOPE} ${GMAIL_COMPOSE_SCOPE}`;

/* The callback half, called from api/google-callback.js for a `gmail.` state:
   trade the code for tokens, note which inbox it is, and keep the refresh
   token server-side. Returns { email } or throws. */
export async function finishGmailConnect({ nonce, code, redirectUri }) {
  if (!getApps().length) throw new Error('Server is missing FIREBASE_SERVICE_ACCOUNT');
  const db = getFirestore();
  const nonceRef = db.doc(`weddingGmailOAuth/${nonce}`);
  const nonceSnap = await nonceRef.get();
  const pending = nonceSnap.data();
  await nonceRef.delete().catch(() => {});
  const created = pending?.createdAt?.toMillis?.() || 0;
  if (!pending?.uid || Date.now() - created > 15 * 60 * 1000) throw new Error('This sign-in link expired — start again from the Venues tab');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await tokenRes.json();
  if (tokens.error) throw new Error(tokens.error_description || tokens.error);
  if (!tokens.refresh_token) throw new Error('Google did not grant offline access — try connecting again');
  if (!String(tokens.scope || '').includes(GMAIL_SCOPE)) throw new Error('Gmail read access was not granted — tick the Gmail box on the Google screen');

  const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  }).then((r) => r.json());
  if (profile.error) throw new Error(profile.error.message || 'Could not read the Gmail profile — is the Gmail API enabled?');
  const email = profile.emailAddress || '';

  await db.doc(`weddingGmailTokens/${pending.uid}`).set({
    refreshToken: tokens.refresh_token,
    email,
    connectedAt: FieldValue.serverTimestamp(),
  });
  // Replaced whole, so a newly linked inbox starts with no "last scanned".
  await db.doc(`users/${pending.uid}`).set({
    weddingGmail: { email, connectedAt: FieldValue.serverTimestamp(), canDraft: String(tokens.scope || '').includes(GMAIL_COMPOSE_SCOPE) },
  }, { mergeFields: ['weddingGmail'] });
  return { email };
}
