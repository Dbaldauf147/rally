// Exports a date range of finalized Rally events as a per-day map, so another
// app (Prep Day's Week Plan) can pull them in. Auth is a shared secret passed
// as ?key= and matched against PLANS_EXPORT_KEY. Mirrors the per-user event
// query used by weekly-digest.js / check-reminders.js.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) {
    initializeApp({ credential: cert(sa) });
  }
}

const DEFAULT_EMAIL = 'baldaufdan@gmail.com';

// Local YYYY-MM-DD (matches the frontend's toDateStr — avoids UTC shifting).
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expectedKey = process.env.PLANS_EXPORT_KEY;
  if (!expectedKey) {
    return res.status(200).json({ skipped: true, reason: 'No PLANS_EXPORT_KEY configured', eventsByDay: {} });
  }
  if ((req.query?.key || '').toString().trim() !== expectedKey.trim()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startStr = (req.query?.start || '').toString().trim();
  const endStr = (req.query?.end || '').toString().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endStr)) {
    return res.status(400).json({ error: 'start and end (YYYY-MM-DD) are required' });
  }
  const winStart = new Date(startStr + 'T00:00:00');
  const winEnd = new Date(endStr + 'T00:00:00');
  if (isNaN(winStart) || isNaN(winEnd) || winEnd < winStart) {
    return res.status(400).json({ error: 'Invalid start/end range' });
  }

  const email = (req.query?.email || DEFAULT_EMAIL).toString().trim().toLowerCase();

  let db;
  try {
    db = getFirestore();
  } catch {
    return res.status(200).json({ skipped: true, reason: 'Firebase Admin not configured', eventsByDay: {} });
  }

  let ownerUid;
  try {
    ownerUid = (await getAuth().getUserByEmail(email)).uid;
  } catch {
    return res.status(200).json({ eventsByDay: {}, reason: `No Firebase user for ${email}` });
  }
  // Mirror the frontend sanitizeKey so we catch events the user was invited to
  // by email before signing up.
  const emailKey = email.replace(/[.@#$/\[\]]/g, '_');

  try {
    const eventsCol = db.collection('events');
    const [createdSnap, memberSnap, emailSnap] = await Promise.all([
      eventsCol.where('createdBy', '==', ownerUid).get(),
      eventsCol.where('memberUids', 'array-contains', ownerUid).get(),
      eventsCol.where('memberUids', 'array-contains', emailKey).get(),
    ]);
    const eventsById = new Map();
    for (const snap of [createdSnap, memberSnap, emailSnap]) {
      for (const d of snap.docs) eventsById.set(d.id, d);
    }

    const eventsByDay = {};
    for (const doc of eventsById.values()) {
      const ev = doc.data();
      if (ev.stage !== 'finalized' || ev.dateTBD) continue;

      const start = ev.date?.toDate ? ev.date.toDate() : (ev.date ? new Date(ev.date) : null);
      if (!start || isNaN(start)) continue;
      let end = ev.endDate?.toDate ? ev.endDate.toDate() : (ev.endDate ? new Date(ev.endDate) : start);
      if (!end || isNaN(end)) end = start;

      // Spread the event across each day it covers within the requested window
      // (matches Plans.jsx rallyByDay logic).
      const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
      for (let i = 0; i < 400 && cur <= last; i++) {
        if (cur >= winStart && cur <= winEnd) {
          const ds = toDateStr(cur);
          (eventsByDay[ds] = eventsByDay[ds] || []).push({
            id: doc.id,
            title: ev.title || '(untitled)',
            location: ev.location || '',
          });
        }
        cur.setDate(cur.getDate() + 1);
      }
    }

    return res.status(200).json({ eventsByDay });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
