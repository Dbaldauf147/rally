// The Guys Night Out steakhouse list from Prep Day, on a Rally event.
//
//   • GET ?eventId=…  — anyone on the event: the list, split into still to go
//     and done (with the days you went), for the event page's card.
//   • POST { eventId } — the organizer only: emails that list to everyone on
//     the event with an email address, organizer included.
//
// The list is one person's — Prep Day's account for PREPDAY_USER_EMAIL — so it
// is only served on an event that person organizes, that has the list
// switched on (src/lib/guysNight.js steakhouseListOn), and only to the
// event's own members. Prep Day lives in another Firebase project, so this
// reads it with that project's service account, as prepday-datespots does.
//
//   PREPDAY_FIREBASE_SERVICE_ACCOUNT  service account JSON for sunday-routine
//   PREPDAY_USER_EMAIL                which Prep Day account to read (optional)
//   FIREBASE_SERVICE_ACCOUNT          Rally's own
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { steakhouseListOn, steakhouseSummary } from '../src/lib/guysNight.js';
import { steakhouseRecipients, steakhouseEmail } from '../src/lib/guysNightEmail.js';
import { sendOne, mailConfigured } from '../lib/mailer.js';

const OWNER_EMAIL = 'baldaufdan@gmail.com';
const ENV = globalThis.process?.env || {};

function rallyApp() {
  if (!getApps().some((a) => a.name === '[DEFAULT]')) {
    const sa = JSON.parse(ENV.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (!sa.project_id) return null;
    initializeApp({ credential: cert(sa) });
  }
  return getApp();
}

function prepdayApp() {
  const existing = getApps().find((a) => a.name === 'prepday');
  if (existing) return existing;
  const sa = JSON.parse(ENV.PREPDAY_FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!sa.project_id) return null;
  return initializeApp({ credential: cert(sa) }, 'prepday');
}

// Prep Day keeps the list at users/{uid}/data/eatingOut.restaurants; the
// field on the user doc is the legacy home (see prepday-datespots).
async function readSteakhouses(prepday) {
  const email = (ENV.PREPDAY_USER_EMAIL || OWNER_EMAIL).trim();
  const prepUser = await getAuth(prepday).getUserByEmail(email);
  const userRef = getFirestore(prepday).doc(`users/${prepUser.uid}`);
  const [userSnap, eatingOutSnap] = await Promise.all([userRef.get(), userRef.collection('data').doc('eatingOut').get()]);
  const fromSubdoc = eatingOutSnap.exists ? eatingOutSnap.data()?.restaurants : null;
  const restaurants = Array.isArray(fromSubdoc)
    ? fromSubdoc
    : (Array.isArray(userSnap.data()?.restaurants) ? userSnap.data().restaurants : []);
  return steakhouseSummary(restaurants);
}

// Who's asking, and is this an event the list may be shown on?
async function authorize(req, eventId) {
  const rally = rallyApp();
  if (!rally) return { status: 500, error: 'Rally credentials are not configured' };
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { status: 401, error: 'Missing bearer token' };
  let claims;
  try {
    claims = await getAuth(rally).verifyIdToken(token);
  } catch {
    return { status: 401, error: 'Invalid token' };
  }
  if (!eventId || typeof eventId !== 'string') return { status: 400, error: 'Missing eventId' };
  const ref = getFirestore(rally).collection('events').doc(eventId);
  const snap = await ref.get();
  if (!snap.exists) return { status: 404, error: 'Event not found' };
  const event = snap.data();
  const memberUids = Array.isArray(event.memberUids) ? event.memberUids : [];
  const onEvent = memberUids.includes(claims.uid) || !!event.members?.[claims.uid] || event.createdBy === claims.uid;
  if (!onEvent) return { status: 403, error: 'Not on this event' };
  if (!steakhouseListOn(event)) return { status: 404, error: 'No steakhouse list on this event' };
  // The list goes only on events its owner organizes.
  let organizerEmail = '';
  try {
    organizerEmail = event.createdBy ? ((await getAuth(rally).getUser(event.createdBy)).email || '') : '';
  } catch { /* deleted account: no list */ }
  if (organizerEmail.trim().toLowerCase() !== OWNER_EMAIL) return { status: 404, error: 'No steakhouse list on this event' };
  const isOrganizer = claims.uid === event.createdBy || event.members?.[claims.uid]?.role === 'owner';
  return { ok: true, claims, ref, event, isOrganizer };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const eventId = req.method === 'GET' ? req.query?.eventId : req.body?.eventId;

  const auth = await authorize(req, eventId);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const prepday = prepdayApp();
  if (!prepday) {
    return res.status(200).json({ todo: [], done: [], total: 0, doneCount: 0, skipped: true, reason: 'No PREPDAY_FIREBASE_SERVICE_ACCOUNT configured' });
  }

  let summary;
  try {
    summary = await readSteakhouses(prepday);
  } catch (err) {
    if (err?.code === 'auth/user-not-found') return res.status(200).json({ todo: [], done: [], total: 0, doneCount: 0, reason: 'No Prep Day account' });
    return res.status(500).json({ error: err?.message || 'Could not read Prep Day' });
  }

  if (req.method === 'GET') return res.status(200).json(summary);

  // POST: email it.
  if (!auth.isOrganizer) return res.status(403).json({ error: 'Only the organizer can email the list.' });
  if (!mailConfigured()) return res.status(500).json({ error: 'Email is not configured' });
  if (summary.total === 0) return res.status(400).json({ error: 'The steakhouse list is empty.' });
  const recipients = steakhouseRecipients(auth.event);
  if (recipients.length === 0) return res.status(400).json({ error: 'Nobody on this event has an email address.' });

  const owner = Object.values(auth.event.members || {}).find((m) => m?.role === 'owner');
  const fromName = String(owner?.name || 'Dan').trim().split(/\s+/)[0] || 'Dan';
  const sent = [];
  const failed = [];
  for (const { member, email } of recipients) {
    const { subject, html } = steakhouseEmail({ event: auth.event, eventId, summary, member, fromName });
    const r = await sendOne({ to: email, subject, html, fromName: 'Rally' });
    if (r.ok) sent.push(email);
    else failed.push({ to: email, error: r.error || 'failed' });
  }
  const stamp = new Date().toISOString();
  await auth.ref.update({
    steakhouseEmailSentAt: stamp,
    steakhouseEmailResults: { sent: sent.length, failed: failed.length, of: recipients.length },
    updatedAt: FieldValue.serverTimestamp(),
  });
  return res.status(200).json({ sent: sent.length, of: recipients.length, failed });
}
