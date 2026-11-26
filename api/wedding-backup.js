/* global process */
// Restore points for the wedding guest list.
//
// The guest list is one array on the user document (`weddingContacts`, and
// `weddingContactsV2` for the second version). One bad write replaces all of
// it, and Firestore keeps no history. This keeps dated copies somewhere the
// browser can't write — `weddingBackups/{uid}/snapshots`, reachable only
// through the Admin SDK here — so whatever a page does to the list, the
// copies survive it.
//
//   • GET  (Vercel Cron, daily) — a copy for every account whose list changed
//     since its last one.
//   • POST { action: 'snapshot' } — a copy now; the guest list page asks for
//     one when it opens (at most hourly).
//   • POST { action: 'list' } — the restore points, newest first.
//   • POST { action: 'restore', id, list: 'main' | 'v2' } — put that copy's
//     list back. The list as it stands is copied first, so a restore can be
//     undone the same way.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { fingerprint, shouldSnapshot, planPrune, backupSummary } from '../lib/weddingBackups.js';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) initializeApp({ credential: cert(sa) });
}

const KEYS = { main: 'weddingContacts', v2: 'weddingContactsV2' };
const arr = (v) => (Array.isArray(v) ? v : []);
const snapshotsOf = (db, uid) => db.collection(`weddingBackups/${uid}/snapshots`);

// Without the guest arrays: enough to list and to decide, cheap to read.
async function summaries(db, uid) {
  const snap = await snapshotsOf(db, uid).select('at', 'reason', 'mainCount', 'v2Count', 'fingerprint').get();
  return snap.docs
    .map((d) => ({ ...backupSummary(d.id, d.data()), fingerprint: d.data()?.fingerprint || '' }))
    .sort((a, b) => b.at - a.at);
}

/* Takes a restore point of `data` (a user document) if one is due. Returns
   its summary, or null when the newest one already covers it. */
export async function takeSnapshot(db, uid, data, reason, now = Date.now()) {
  const main = arr(data?.[KEYS.main]);
  const v2 = arr(data?.[KEYS.v2]);
  const existing = await summaries(db, uid);
  if (!shouldSnapshot({ main, v2, reason, latest: existing[0], now })) return null;
  const entry = { at: now, reason, fingerprint: fingerprint(main, v2), main, v2, mainCount: main.length, v2Count: v2.length };
  const ref = snapshotsOf(db, uid).doc();
  await ref.set(entry);
  const drop = planPrune([...existing, { id: ref.id, at: now }], now);
  await Promise.all(drop.map((id) => snapshotsOf(db, uid).doc(id).delete().catch(() => {})));
  return backupSummary(ref.id, entry);
}

async function daily(req, res, db) {
  // Vercel sends the project's CRON_SECRET as a bearer token when one is set.
  const secret = process.env.CRON_SECRET;
  if (secret && String(req.headers.authorization || '') !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const users = await db.collection('users').get();
  const results = [];
  for (const userDoc of users.docs) {
    try {
      const made = await takeSnapshot(db, userDoc.id, userDoc.data() || {}, 'daily');
      if (made) results.push({ uid: userDoc.id, guests: made.mainCount });
    } catch (err) {
      console.error('Wedding backup failed for', userDoc.id, err);
      results.push({ uid: userDoc.id, error: err.message });
    }
  }
  return res.status(200).json({ ok: true, saved: results });
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!getApps().length) return res.status(500).json({ error: 'Server is missing FIREBASE_SERVICE_ACCOUNT' });
  const db = getFirestore();
  if (req.method === 'GET') return daily(req, res, db);

  let uid;
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    uid = (await getAuth().verifyIdToken(token)).uid;
  } catch {
    return res.status(401).json({ error: 'Sign in again' });
  }

  const { action, id, list } = req.body || {};
  const userRef = db.doc(`users/${uid}`);
  const strip = (b) => { const { fingerprint: _f, ...rest } = b; return rest; };

  try {
    if (action === 'list') {
      return res.status(200).json({ backups: (await summaries(db, uid)).map(strip) });
    }

    if (action === 'snapshot') {
      const data = (await userRef.get()).data() || {};
      const made = await takeSnapshot(db, uid, data, 'open');
      return res.status(200).json({ saved: !!made, backup: made });
    }

    if (action === 'restore') {
      const key = KEYS[list];
      if (!key || !id) return res.status(400).json({ error: 'Which restore point, and which list?' });
      const snap = await snapshotsOf(db, uid).doc(String(id)).get();
      if (!snap.exists) return res.status(404).json({ error: 'That restore point is gone' });
      const guests = arr(snap.data()?.[list]);
      if (!guests.length) return res.status(400).json({ error: 'That restore point has no guests on this list' });
      // What's there now is copied first, so this can be undone.
      const before = (await userRef.get()).data() || {};
      await takeSnapshot(db, uid, before, 'before-restore');
      await userRef.set({ [key]: guests }, { mergeFields: [key] });
      return res.status(200).json({ restored: guests.length, replaced: arr(before[key]).length });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('wedding-backup', action, err);
    return res.status(500).json({ error: err.message || 'Something went wrong' });
  }
}
