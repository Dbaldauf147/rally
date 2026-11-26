/* global process */
// The Friends trash (lib/peopleTrash.js): thirty days in which a deleted or
// merged-away contact can be put back.
//
//   POST { action: 'trash', ids, reason } — move contacts to the trash.
//   POST { action: 'list' }               — what's in it, newest first.
//   POST { action: 'restore', itemIds }   — put contacts back as they were.
//
// The trash is emptied of anything older than thirty days by the daily
// people-backup run, and whenever it is listed.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { trashFriends, listTrash, restoreTrash, purgeTrash, TRASH_DAYS } from '../lib/peopleTrash.js';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) initializeApp({ credential: cert(sa) });
}

const MAX_IDS = 2000;

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
  const { action, ids, itemIds, reason } = req.body || {};
  const idList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x && !x.includes('/')).slice(0, MAX_IDS) : []);

  try {
    if (action === 'trash') {
      const list = idList(ids);
      if (!list.length) return res.status(400).json({ error: 'Which contacts?' });
      return res.status(200).json({ trashed: await trashFriends(db, uid, list, { reason }), days: TRASH_DAYS });
    }
    if (action === 'list') {
      await purgeTrash(db, uid).catch((err) => console.error('people-trash purge', err));
      return res.status(200).json({ items: await listTrash(db, uid), days: TRASH_DAYS });
    }
    if (action === 'restore') {
      const list = idList(itemIds);
      if (!list.length) return res.status(400).json({ error: 'Which contacts?' });
      return res.status(200).json(await restoreTrash(db, uid, list));
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('people-trash', action, err);
    return res.status(500).json({ error: err.message || 'Something went wrong' });
  }
}
