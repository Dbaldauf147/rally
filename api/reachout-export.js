// Exports the "reached out today" count from the user's Rally Reach Out page so
// Prep Day's Habits KPI can show it as a daily goal. The count = contacts whose
// lastReachOut matches the given day (data lives on users/{uid}.reachOuts, the
// same array ReachOutPage.jsx reads). Auth is the shared secret (?key= matched
// to PLANS_EXPORT_KEY), same as plans-export.js / voting-export.js.
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

// The serverless region runs in UTC, but "today" is the user's LOCAL day, so the
// caller passes ?date. This is only a fallback when it doesn't.
function utcTodayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expectedKey = process.env.PLANS_EXPORT_KEY;
  if (!expectedKey) {
    return res.status(200).json({ skipped: true, reason: 'No PLANS_EXPORT_KEY configured', reachedTodayCount: 0 });
  }
  if ((req.query?.key || '').toString().trim() !== expectedKey.trim()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // The consuming browser passes its local day; fall back to the region's UTC day.
  let date = (req.query?.date || '').toString().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = utcTodayKey();

  const email = (req.query?.email || DEFAULT_EMAIL).toString().trim().toLowerCase();

  let reachOuts = [];
  try {
    const db = getFirestore();
    const ownerUid = (await getAuth().getUserByEmail(email)).uid;
    const snap = await db.collection('users').doc(ownerUid).get();
    reachOuts = snap.exists && Array.isArray(snap.data().reachOuts) ? snap.data().reachOuts : [];
  } catch (err) {
    return res.status(200).json({ reachedTodayCount: 0, date, reason: err.message });
  }

  const onDay = reachOuts.filter(c => c && c.lastReachOut === date);
  return res.status(200).json({
    reachedTodayCount: onDay.length,
    reachedFamilyToday: onDay.some(c => (c.category || '') === 'Family'),
    reachedFriendToday: onDay.some(c => /friend/i.test(c.category || '')),
    date,
  });
}
