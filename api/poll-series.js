// Vercel Cron, daily: opens the next round of every poll-based recurring event
// whose current round has happened (see src/lib/pollSeries.js).
//
// For each due round, in one transaction: create the next round (a new event
// in Voting with the same guests), seed its date poll, and stamp the old round
// with `nextRoundId` — re-read inside the transaction, so two runs racing never
// open the same round twice.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { nextRoundDue, buildNextRound, seedOptions, dayInZone, normalizePollSeries } from '../src/lib/pollSeries.js';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) initializeApp({ credential: cert(sa) });
}

// The owner's day decides when a round is "over"; Rally's users are on US
// Eastern, as the other daily jobs assume.
const TIME_ZONE = 'America/New_York';

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
    const { doc, target } = buildNextRound(event, eventId, { timeZone: TIME_ZONE, shareToken });
    const nextRef = db.collection('events').doc();
    const owner = Object.values(event.members || {}).find((m) => m?.role === 'owner');
    tx.set(nextRef, {
      ...doc,
      date: Timestamp.fromDate(new Date(Date.UTC(target.year, target.month - 1, 1, 12))),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const finalizedDay = dayInZone((event.date?.toDate ? event.date.toDate() : new Date(event.date)), TIME_ZONE);
    for (const o of seedOptions(lastOptions, target, finalizedDay)) {
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
    return { from: eventId, to: nextRef.id, round: doc.pollSeries.round, month: `${target.year}-${target.month}` };
  });
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
  const opened = [];
  const errors = [];
  try {
    // Only events in a series; a single-field range filter needs no index.
    const snap = await db.collection('events').where('pollSeries.everyMonths', '>', 0).get();
    for (const d of snap.docs) {
      if (!nextRoundDue(d.data(), now, TIME_ZONE)) continue;
      try {
        const r = await openNextRound(db, d.id, now);
        if (r) opened.push(r);
      } catch (err) {
        errors.push({ id: d.id, error: err.message });
      }
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  return res.status(200).json({ checked: true, opened, errors });
}
