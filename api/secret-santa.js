// Secret Santa (see src/lib/secretSanta.js).
//
// POST { eventId, pairs: [{ giver, receiver }], note?, when?, only?: [giverKey], drawName? }
// with the organizer's Firebase ID token. Emails each giver the name of the
// person they are buying for. Only the event's organizer may call it, and the
// names and addresses come from the event doc, so it can only ever write to
// that event's own guests. `drawName` names an extra exchange on the same
// event ("Sibs Secret Santa"), so someone in two of them can tell the emails apart.
//
// Nothing is stored here: the draw itself lives on the organizer's user doc,
// written by the browser, so the pairs never sit anywhere a guest can read.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { planSecretSantaSend, personLabel, exchangeTitle } from '../src/lib/secretSanta.js';
import { secretSantaEmail } from '../src/lib/secretSantaEmail.js';
import { revealLink } from '../src/lib/secretSantaLink.js';
import { sendOne, mailConfigured } from '../lib/mailer.js';

if (!getApps().length) {
  const sa = JSON.parse(globalThis.process?.env?.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) initializeApp({ credential: cert(sa) });
}

const clip = (s, n) => String(s || '').trim().slice(0, n);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let db;
  try {
    db = getFirestore();
  } catch {
    return res.status(503).json({ error: 'Email sending is not set up on this deployment.' });
  }
  if (!mailConfigured()) return res.status(503).json({ error: 'No email provider is configured.' });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Sign in to send the names.' });
  let uid;
  try {
    uid = (await getAuth().verifyIdToken(token)).uid;
  } catch {
    return res.status(401).json({ error: 'Your sign-in has expired — reload and try again.' });
  }

  const eventId = String(req.body?.eventId || '');
  if (!eventId) return res.status(400).json({ error: 'eventId required' });
  const snap = await db.collection('events').doc(eventId).get();
  if (!snap.exists) return res.status(404).json({ error: 'Event not found' });
  const event = snap.data();
  if (event.members?.[uid]?.role !== 'owner' && event.createdBy !== uid) {
    return res.status(403).json({ error: 'Only the organizer can send the names.' });
  }

  const plan = planSecretSantaSend(event, req.body?.pairs, req.body?.only);
  if (plan.error) return res.status(400).json({ error: plan.error });

  const owner = Object.values(event.members || {}).find((m) => m?.role === 'owner') || event.members?.[uid];
  const fromName = owner ? personLabel(owner) : 'The organizer';
  const sent = [];
  const failed = [];
  for (const m of plan.mail) {
    const details = {
      giverName: m.giverName,
      receiverName: m.receiverName,
      eventTitle: exchangeTitle(event.title, req.body?.drawName),
      when: clip(req.body?.when, 80),
      location: event.location,
      note: clip(req.body?.note, 1000),
      fromName,
    };
    // The email says a pick is ready; the name is only on the page its button opens.
    const { subject, html } = secretSantaEmail({ ...details, link: revealLink(details) });
    const r = await sendOne({ to: m.to, subject, html, fromName: 'Rally' });
    if (r.ok) sent.push(m.key);
    else failed.push({ key: m.key, error: r.error || 'send failed' });
  }
  return res.status(200).json({ sent, failed, noEmail: plan.noEmail });
}
