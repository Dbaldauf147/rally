// Emails where the date vote stands for one event: what is on the table, how
// each option is doing, and who has not voted yet.
//
// The client says WHO gets it; WHAT it says is read here from Firestore and
// built by src/lib/votingStatus.js — the same module the numbers are tested
// against — so a caller cannot dictate the contents, and the mail cannot drift
// from the event page. Sibling of weekly-digest.js, which does this across every
// unscheduled event rather than one.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { summarizeVoting, renderVotingStatusEmail } from '../src/lib/votingStatus.js';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) {
    initializeApp({ credential: cert(sa) });
  }
}

const APP_URL = 'https://rally-seven-theta.vercel.app';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { eventId, recipients, fromName } = req.body || {};
  if (!eventId) return res.status(400).json({ error: 'No eventId provided' });
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: 'No recipients provided' });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return res.status(200).json({ sent: 0, message: 'No email service configured.' });
  }

  let db;
  try {
    db = getFirestore();
  } catch {
    return res.status(200).json({ sent: 0, message: 'Firebase Admin not configured.' });
  }

  try {
    const eventSnap = await db.collection('events').doc(eventId).get();
    if (!eventSnap.exists) return res.status(404).json({ error: 'Event not found' });
    const event = eventSnap.data();

    const optsSnap = await db.collection('events').doc(eventId).collection('dateOptions').get();
    const options = optsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const summary = summarizeVoting(event, options);
    const { subject, html } = renderVotingStatusEmail({ event, eventId, summary, fromName, appUrl: APP_URL });

    const results = [];
    for (const r of recipients) {
      if (!r?.email) { results.push({ name: r?.name, success: false, error: 'No email' }); continue; }
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'Rally <noreply@resend.dev>', to: [r.email], subject, html }),
        });
        if (response.ok) {
          results.push({ name: r.name, email: r.email, success: true });
        } else {
          const err = await response.json().catch(() => ({}));
          results.push({ name: r.name, email: r.email, success: false, error: err.message || `HTTP ${response.status}` });
        }
      } catch (err) {
        results.push({ name: r.name, email: r.email, success: false, error: err.message });
      }
    }

    const sent = results.filter(r => r.success).length;
    return res.status(200).json({ sent, total: recipients.length, results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
