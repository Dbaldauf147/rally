// Poll-based recurring events (see src/lib/pollSeries.js).
//
//   • GET — Vercel Cron, daily. For every round in a series: a week before
//     the next send date, open the next round; a week before a round's send
//     date, email the organizer a heads-up; on the send date, email the guest
//     list to suggest dates and vote.
//   • POST { eventId } with the owner's Firebase ID token — "Send poll now"
//     on the event page: sends this round's email immediately, whatever its
//     send date, so a host who has just added the guests needn't wait a day.
//
// Opening a round happens in one transaction that re-reads the old round, so
// two runs racing never open the same round twice. Sending claims the round
// first (`pollSentAt`, in a transaction) and only then emails, so a round is
// never emailed twice either.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { randomUUID } from 'node:crypto';
import {
  nextRoundDue, pollSendDue, pollPreviewDue, buildNextRound, seedOptions, seedOptionsInRange, dayInZone, normalizePollSeries,
} from '../src/lib/pollSeries.js';
import { pollRecipients, pollInviteEmail, ownerPreviewEmail } from '../src/lib/pollSeriesEmail.js';
import { sendOne, gmailConfigured } from '../lib/mailer.js';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) initializeApp({ credential: cert(sa) });
}

// The owner's day decides send dates and when a round is "over"; Rally's users
// are on US Eastern, as the other daily jobs assume.
const TIME_ZONE = 'America/New_York';

const provider = () => (gmailConfigured() ? 'gmail' : process.env.RESEND_API_KEY ? 'resend' : 'none');

export async function openNextRound(db, eventId, now = new Date()) {
  const ref = db.collection('events').doc(eventId);
  const optsSnap = await ref.collection('dateOptions').get();
  const lastOptions = optsSnap.docs.map((d) => d.data()).filter((o) => !o.noVote);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const event = snap.data();
    if (!nextRoundDue(event, now, TIME_ZONE)) return null;

    const shareToken = randomUUID().replace(/-/g, '').slice(0, 12);
    const { doc, target, window } = buildNextRound(event, eventId, { timeZone: TIME_ZONE, shareToken });
    const nextRef = db.collection('events').doc();
    const owner = Object.values(event.members || {}).find((m) => m?.role === 'owner');
    const firstDay = window ? window.from : `${target.year}-${String(target.month).padStart(2, '0')}-01`;
    tx.set(nextRef, {
      ...doc,
      date: Timestamp.fromDate(new Date(`${firstDay}T12:00:00Z`)),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    // The weekday the round landed on is the fallback pattern — only known if
    // it was finalized.
    const settled = (event.stage || 'voting') === 'finalized' && !event.dateTBD && event.date;
    const finalizedDay = settled ? dayInZone(event.date.toDate ? event.date.toDate() : new Date(event.date), TIME_ZONE) : null;
    const seeded = window ? seedOptionsInRange(lastOptions, window, finalizedDay) : seedOptions(lastOptions, target, finalizedDay);
    for (const o of seeded) {
      tx.set(nextRef.collection('dateOptions').doc(), {
        ...o,
        note: '',
        votes: {},
        suggestedBy: event.createdBy || '',
        suggestedByName: owner?.name || 'Rally',
        seeded: true,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    // The first round learns its series id here, if it never had one.
    const series = normalizePollSeries(event.pollSeries);
    tx.update(ref, {
      nextRoundId: nextRef.id,
      ...(series.seriesId ? {} : { 'pollSeries.seriesId': eventId }),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { from: eventId, to: nextRef.id, round: doc.pollSeries.round, sendDate: doc.pollSendDate || null, options: seeded.length };
  });
}

/* Email this round's guests to suggest dates and vote. `force` skips the send
 * date (the owner pressed Send poll now) but never a second send. */
export async function sendRoundPoll(db, eventId, now = new Date(), { force = false, send = sendOne } = {}) {
  const ref = db.collection('events').doc(eventId);
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const event = snap.data();
    const ok = force
      ? !!normalizePollSeries(event.pollSeries) && !event.pollSentAt && !event.cancelled
      : pollSendDue(event, now, TIME_ZONE);
    if (!ok) return null;
    tx.update(ref, { pollSentAt: now.toISOString(), updatedAt: FieldValue.serverTimestamp() });
    return event;
  });
  if (!claimed) return null;

  const recipients = pollRecipients(claimed);
  const sent = [];
  const failed = [];
  for (const { key, member } of recipients) {
    const { subject, html } = pollInviteEmail({ event: claimed, eventId, key, member });
    const r = await send({ to: member.email, subject, html, fromName: 'Rally' });
    if (r.ok) sent.push(key);
    else failed.push({ to: member.email, error: r.error || 'failed' });
  }
  const stamp = now.toISOString();
  await ref.update({
    pollSendResults: { sent: sent.length, failed: failed.length, of: recipients.length, via: provider(), errors: failed.slice(0, 5) },
    ...Object.fromEntries(sent.map((k) => [`members.${k}.emailed`, stamp])),
  });
  return { eventId, sent: sent.length, failed, of: recipients.length, via: provider() };
}

// The organizer's address: their sign-in account first (the guest-list entry
// for the organizer often has no email on it), then whatever the list says.
async function ownerEmail(event) {
  try {
    if (event.createdBy) {
      const u = await getAuth().getUser(event.createdBy);
      if (u.email) return u.email;
    }
  } catch { /* fall through to the guest list */ }
  return Object.values(event.members || {}).find((m) => m?.role === 'owner')?.email || '';
}

/* The organizer's heads-up, a week before the guests' email. Claimed first
 * (`pollPreviewSentAt`) so it never goes twice; the outcome is recorded on
 * `pollPreviewResult`. */
export async function sendOwnerPreview(db, eventId, now = new Date(), { send = sendOne, emailOf = ownerEmail } = {}) {
  const ref = db.collection('events').doc(eventId);
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const event = snap.data();
    if (!pollPreviewDue(event, now, TIME_ZONE)) return null;
    tx.update(ref, { pollPreviewSentAt: now.toISOString(), updatedAt: FieldValue.serverTimestamp() });
    return event;
  });
  if (!claimed) return null;
  const to = await emailOf(claimed);
  if (!to) {
    await ref.update({ pollPreviewResult: { ok: false, error: 'No email address for the organizer' } });
    return { eventId, ok: false, error: 'no organizer email' };
  }
  const optsSnap = await ref.collection('dateOptions').get();
  const options = optsSnap.docs.map((d) => d.data()).filter((o) => !o.noVote && !o.closed);
  const { subject, html } = ownerPreviewEmail({ event: claimed, eventId, options, today: dayInZone(now, TIME_ZONE) });
  const r = await send({ to, subject, html, fromName: 'Rally' });
  await ref.update({ pollPreviewResult: r.ok ? { ok: true, to, via: provider() } : { ok: false, to, error: r.error || 'failed' } });
  return { eventId, ok: !!r.ok, to };
}

async function runDaily(db, now) {
  const opened = [];
  const previewed = [];
  const emailed = [];
  const errors = [];
  // Only events in a series; a single-field range filter needs no index.
  const snap = await db.collection('events').where('pollSeries.everyMonths', '>', 0).get();
  for (const d of snap.docs) {
    const event = d.data();
    try {
      if (nextRoundDue(event, now, TIME_ZONE)) {
        const r = await openNextRound(db, d.id, now);
        if (r) {
          opened.push(r);
          // A new round opens on its heads-up day; catching up after a missed
          // run, its send date may already be here too.
          const pv = await sendOwnerPreview(db, r.to, now);
          if (pv) previewed.push(pv);
          const e = await sendRoundPoll(db, r.to, now);
          if (e) emailed.push(e);
        }
      }
      // The heads-up goes before the guests' email, even when both fall due
      // on the same run (a round scheduled less than a week out).
      if (pollPreviewDue(event, now, TIME_ZONE)) {
        const pv = await sendOwnerPreview(db, d.id, now);
        if (pv) previewed.push(pv);
      }
      if (pollSendDue(event, now, TIME_ZONE)) {
        const e = await sendRoundPoll(db, d.id, now);
        if (e) emailed.push(e);
      }
    } catch (err) {
      errors.push({ id: d.id, error: err.message });
    }
  }
  return { opened, previewed, emailed, errors };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  let db;
  try {
    db = getFirestore();
  } catch {
    return res.status(200).json({ skipped: true, reason: 'Firebase Admin not configured.' });
  }
  const now = new Date();

  if (req.method === 'POST') {
    // Send poll now — only the event's owner can.
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ error: 'Sign in to send the poll.' });
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
    if (snap.data().members?.[uid]?.role !== 'owner') return res.status(403).json({ error: 'Only the organizer can send the poll.' });
    try {
      const r = await sendRoundPoll(db, eventId, now, { force: true });
      if (!r) return res.status(409).json({ error: 'This round’s poll has already gone out.' });
      return res.status(200).json(r);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  try {
    const out = await runDaily(db, now);
    return res.status(200).json({ checked: true, via: provider(), ...out });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
