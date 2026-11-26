/* global process */
// The daily backup file of everything about people.
//
// Friends contacts live one document each under users/{uid}/friends, and the
// lists made of people (guest lists, Reach Out, gifts) are fields on the user
// document. Firestore keeps no history of either. Once a day this writes all
// of it to one JSON file (lib/peopleBackup.js) and keeps the file in two
// places that don't share a fate:
//
//   • peopleBackups/{uid}/days — gzipped, readable only through the Admin SDK
//     here, so nothing a page does can touch it. Downloaded from the Friends
//     page, which can also add back contacts that have gone missing.
//   • the owner's inbox, as an attachment — a copy outside Firebase entirely.
//     Sent only on a day something changed, and it says so up front when a
//     list has shrunk sharply.
//
//   GET  (Vercel Cron, daily) — every account with people data.
//   POST { action: 'list' }                 — the files, newest first.
//   POST { action: 'run' }                  — a file now (no email).
//   POST { action: 'download', id }         — one file's contents.
//   POST { action: 'restoreMissing', id }   — add back contacts in that file
//                                             that aren't in Friends now.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import {
  buildPeopleFile, fileFingerprint, fileName, changesSince, dropWarnings,
  toChunks, fromChunks, missingFriends, photosFingerprint, PEOPLE_FIELDS,
} from '../lib/peopleBackup.js';
import { planPrune } from '../lib/weddingBackups.js';
import { sendOne, mailConfigured } from '../lib/mailer.js';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) initializeApp({ credential: cert(sa) });
}

// The account the daily email is on for unless switched off; anyone else
// switches it on for themselves (users/{uid}.peopleBackup.email).
const OWNER_EMAIL = 'baldaufdan@gmail.com';
// Gmail refuses a message over 25 MB, and base64 adds a third.
const MAX_PHOTO_ATTACHMENT = 15 * 1024 * 1024;

const daysOf = (db, uid) => db.collection(`peopleBackups/${uid}/days`);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function summaries(db, uid) {
  const snap = await daysOf(db, uid).select('at', 'counts', 'fingerprint', 'photoFingerprint', 'bytes', 'chunks', 'reason').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.at - a.at);
}

async function deleteDay(db, uid, day) {
  for (let i = 0; i < (day.chunks || 0); i += 1) {
    await daysOf(db, uid).doc(day.id).collection('chunks').doc(String(i)).delete().catch(() => {});
  }
  await daysOf(db, uid).doc(day.id).delete().catch(() => {});
}

async function readFile(db, uid, id) {
  const meta = await daysOf(db, uid).doc(id).get();
  if (!meta.exists) return null;
  const n = meta.data()?.chunks || 0;
  const chunks = [];
  for (let i = 0; i < n; i += 1) {
    const c = await daysOf(db, uid).doc(id).collection('chunks').doc(String(i)).get();
    if (!c.exists) throw new Error('That backup is incomplete');
    chunks.push(c.data().data);
  }
  return fromChunks(chunks);
}

const hasPeople = (userData, friends) => friends.length > 0
  || PEOPLE_FIELDS.some((k) => Array.isArray(userData?.[k]) && userData[k].length);

/* Writes today's file for one account if anything changed since the last.
   Returns { saved, file, meta, previous } — saved false when nothing did. */
export async function backupAccount(db, uid, userData, { reason = 'daily', now = Date.now() } = {}) {
  const friendSnap = await db.collection(`users/${uid}/friends`).get();
  const friends = friendSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!hasPeople(userData, friends)) return { saved: false, empty: true };
  const file = buildPeopleFile({ userData, friends, now });
  const fingerprint = fileFingerprint(file);
  const existing = await summaries(db, uid);
  const previous = existing[0];
  if (previous?.fingerprint === fingerprint) return { saved: false, previous };

  const chunks = toChunks(file);
  const ref = daysOf(db, uid).doc();
  // Pieces first: a file listed is a file that can be read.
  for (let i = 0; i < chunks.length; i += 1) {
    await ref.collection('chunks').doc(String(i)).set({ data: chunks[i] });
  }
  const meta = {
    at: now, reason, fingerprint, counts: file.counts, chunks: chunks.length,
    bytes: chunks.reduce((n, c) => n + c.length, 0),
    photoFingerprint: previous?.photoFingerprint || '',
  };
  await ref.set(meta);
  const all = [...existing, { id: ref.id, ...meta }];
  const drop = new Set(planPrune(all, now));
  for (const day of all) if (drop.has(day.id)) await deleteDay(db, uid, day);
  return { saved: true, file, meta: { id: ref.id, ...meta }, previous };
}

/* The pictures in people's family trees, as a second attachment — only on a
   day the set of pictures changed, since they are most of the bytes. */
async function photosAttachment(db, uid, result, iso) {
  const snap = await db.collection(`users/${uid}/familyPhotos`).get();
  const photos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!photos.length) return { attachment: null, note: '' };
  const fp = photosFingerprint(photos);
  if (fp === result.previous?.photoFingerprint) return { attachment: null, note: '' };
  const content = JSON.stringify({ app: 'Rally', kind: 'people-photos', exportedAt: iso, photos });
  if (content.length > MAX_PHOTO_ATTACHMENT) {
    return { attachment: null, note: `The ${photos.length} family-tree photos are too large to attach (${Math.round(content.length / 1048576)} MB), so they are not in this email.` };
  }
  await daysOf(db, uid).doc(result.meta.id).set({ photoFingerprint: fp }, { merge: true });
  return { attachment: { filename: fileName(iso, 'people-photos'), content }, note: `Family-tree photos changed, so all ${photos.length} are attached as a second file.` };
}

export function emailHtml({ file, previous, warnings, changes, photoNote }) {
  const c = file.counts;
  const row = (label, n) => `<tr><td style="padding:2px 14px 2px 0;color:#6b7280;">${label}</td><td style="font-weight:600;">${n}</td></tr>`;
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;color:#111827;max-width:560px;">
${warnings.length ? `<div style="border:1px solid #dc2626;background:#fee2e2;color:#991b1b;border-radius:8px;padding:10px 12px;margin:0 0 14px;"><strong>Check this:</strong> ${warnings.map(esc).join('; ')}. If that wasn’t you, restore from yesterday’s file or from Friends → Backups.</div>` : ''}
<p style="margin:0 0 10px;">Today’s backup of everything Rally holds about people is attached.</p>
<table style="border-collapse:collapse;margin:0 0 10px;">${row('Contacts', c.friends)}${row('Wedding guests', c.guests)}${c.guestsV2 ? row('Second-version guests', c.guestsV2) : ''}${row('Reach Out entries', c.reachOuts)}</table>
<p style="margin:0 0 10px;color:#374151;">${previous ? (changes.length ? `Since the last backup: ${changes.map(esc).join(', ')}.` : 'Same number of people as the last backup; details changed.') : 'This is the first backup.'}</p>
${photoNote ? `<p style="margin:0 0 10px;color:#374151;">${esc(photoNote)}</p>` : ''}
<p style="margin:0;color:#6b7280;font-size:13px;">Sent only on days something changed. The same file is kept in Rally under Friends → Backups, where missing contacts can be put back. Keep these emails: they are the copy that doesn’t depend on Rally’s database.</p>
</div>`;
}

const wantsEmail = (userData) => {
  const pref = userData?.peopleBackup?.email;
  if (typeof pref === 'boolean') return pref;
  return String(userData?.email || '').toLowerCase() === OWNER_EMAIL;
};

async function daily(req, res, db) {
  // Vercel sends the project's CRON_SECRET as a bearer token when one is set.
  const secret = process.env.CRON_SECRET;
  if (secret && String(req.headers.authorization || '') !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const users = await db.collection('users').get();
  const results = [];
  for (const userDoc of users.docs) {
    const uid = userDoc.id;
    const userData = userDoc.data() || {};
    try {
      const result = await backupAccount(db, uid, userData);
      if (!result.saved) continue;
      const entry = { uid, ...result.file.counts, emailed: false };
      if (wantsEmail(userData) && userData.email && mailConfigured()) {
        const iso = result.file.exportedAt;
        const warnings = dropWarnings(result.previous?.counts, result.file.counts);
        const changes = changesSince(result.previous?.counts, result.file.counts);
        const { attachment, note } = await photosAttachment(db, uid, result, iso).catch(() => ({ attachment: null, note: '' }));
        const sent = await sendOne({
          to: userData.email,
          subject: `${warnings.length ? '⚠️ ' : ''}Rally people backup · ${iso.slice(0, 10)} · ${result.file.counts.friends} contacts, ${result.file.counts.guests} guests`,
          html: emailHtml({ file: result.file, previous: result.previous, warnings, changes, photoNote: note }),
          attachments: [
            { filename: fileName(iso), content: JSON.stringify(result.file, null, 1) },
            ...(attachment ? [attachment] : []),
          ],
        });
        entry.emailed = sent.ok;
        if (!sent.ok) entry.emailError = sent.error;
        await daysOf(db, uid).doc(result.meta.id).set({ emailed: sent.ok, ...(sent.ok ? {} : { emailError: sent.error || '' }) }, { merge: true });
      }
      results.push(entry);
    } catch (err) {
      console.error('People backup failed for', uid, err);
      results.push({ uid, error: err.message });
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
  const { action, id } = req.body || {};
  const summary = (d) => ({ id: d.id, at: d.at, counts: d.counts || {}, bytes: d.bytes || 0, reason: d.reason || 'daily', emailed: !!d.emailed });

  try {
    if (action === 'list') {
      const userData = (await db.doc(`users/${uid}`).get()).data() || {};
      const snap = await daysOf(db, uid).select('at', 'counts', 'bytes', 'reason', 'emailed').get();
      const files = snap.docs.map((d) => summary({ id: d.id, ...d.data() })).sort((a, b) => b.at - a.at);
      return res.status(200).json({ files, email: wantsEmail(userData), emailTo: userData.email || '', mail: mailConfigured() });
    }

    if (action === 'run') {
      const userData = (await db.doc(`users/${uid}`).get()).data() || {};
      const result = await backupAccount(db, uid, userData, { reason: 'manual' });
      return res.status(200).json({ saved: result.saved, file: result.saved ? summary(result.meta) : null });
    }

    if (action === 'download' || action === 'restoreMissing') {
      if (!id) return res.status(400).json({ error: 'Which backup?' });
      const file = await readFile(db, uid, String(id));
      if (!file) return res.status(404).json({ error: 'That backup is gone' });
      if (action === 'download') {
        return res.status(200).json({ filename: fileName(file.exportedAt), json: JSON.stringify(file, null, 1) });
      }
      const current = await db.collection(`users/${uid}/friends`).select().get();
      const missing = missingFriends(file, current.docs.map((d) => d.id));
      for (const f of missing) {
        const { id: fid, ...data } = f;
        await db.collection(`users/${uid}/friends`).doc(String(fid)).set(data);
      }
      return res.status(200).json({ restored: missing.length, names: missing.slice(0, 20).map((f) => f.name || f.id) });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('people-backup', action, err);
    return res.status(500).json({ error: err.message || 'Something went wrong' });
  }
}
