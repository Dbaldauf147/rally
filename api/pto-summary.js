// Annual PTO summary: on November 1st, an email of the year's time off — days
// left, days scheduled, and the days already taken — read from the same
// users/<uid>.pto the PTO page writes. The numbers and wording live in
// lib/ptoSummary.js.
//
// Three entry points, matching api/wedding-digest.js:
//   • GET  (Vercel Cron) — fires at 12:00 and 13:00 UTC on Nov 1 (8 AM Eastern
//     either side of the daylight-saving change); sends once per year.
//   • POST { uid, preview: true } — returns the HTML without sending.
//   • POST { uid } — "send now", to the addresses saved on the PTO page. It
//     never takes an address from the request.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { sendOne, mailConfigured } from '../lib/mailer.js';
import { ptoSummaryConfig, isPtoSummaryDue, summarizePtoYear, buildPtoEmail, localIso } from '../lib/ptoSummary.js';

if (!getApps().length) {
  const sa = JSON.parse(globalThis.process?.env?.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) initializeApp({ credential: cert(sa) });
}

export function buildForUser(userData, now = new Date()) {
  const cfg = ptoSummaryConfig(userData);
  const pto = userData?.pto;
  if (!pto || !Array.isArray(pto.years)) return { skipped: 'no PTO saved yet', cfg };
  const todayIso = localIso(now, cfg.timezone);
  const summary = summarizePtoYear(pto, Number(todayIso.slice(0, 4)), todayIso);
  return { cfg, summary, ...buildPtoEmail(summary) };
}

// One email per address, so a refused address doesn't cost the others theirs.
async function sendTo(emails, built) {
  const sentTo = [];
  const failed = [];
  for (const to of emails) {
    const r = await sendOne({ to, subject: built.subject, html: built.html, fromName: 'Rally PTO' });
    if (r.ok) sentTo.push(to);
    else failed.push({ email: to, error: r.error });
  }
  return { sentTo, failed };
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

  if (req.method === 'POST' && req.body?.preview) {
    const uid = req.body?.uid;
    if (!uid) return res.status(400).json({ error: 'uid required' });
    try {
      const snap = await db.collection('users').doc(uid).get();
      if (!snap.exists) return res.status(404).json({ error: 'user not found' });
      const built = buildForUser(snap.data());
      if (built.skipped) return res.status(200).json({ skipped: built.skipped });
      return res.status(200).json({ html: built.html, subject: built.subject });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (!mailConfigured()) {
    return res.status(200).json({ skipped: true, reason: 'No email provider configured (GMAIL_USER/GMAIL_APP_PASSWORD or RESEND_API_KEY)' });
  }

  if (req.method === 'POST') {
    const uid = req.body?.uid;
    if (!uid) return res.status(400).json({ error: 'uid required' });
    try {
      const snap = await db.collection('users').doc(uid).get();
      if (!snap.exists) return res.status(404).json({ error: 'user not found' });
      const built = buildForUser(snap.data());
      if (built.skipped) return res.status(200).json({ sent: 0, skipped: built.skipped });
      if (!built.cfg.emails.length) return res.status(200).json({ sent: 0, skipped: 'no address to send to' });
      const out = await sendTo(built.cfg.emails, built);
      if (!out.sentTo.length) return res.status(502).json({ sent: 0, ...out, error: out.failed.map((f) => `${f.email}: ${f.error}`).join('; ') });
      return res.status(200).json({ sent: out.sentTo.length, ...out });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Cron.
  const now = new Date();
  const results = [];
  try {
    const usersSnap = await db.collection('users').get();
    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      const cfg = ptoSummaryConfig(data);
      if (!isPtoSummaryDue(cfg, now)) continue;
      const built = buildForUser(data, now);
      if (built.skipped) { results.push({ uid: userDoc.id, skipped: built.skipped }); continue; }
      const out = await sendTo(cfg.emails, built);
      const lastResult = { at: now.toISOString(), sentTo: out.sentTo, failed: out.failed };
      await db.collection('users').doc(userDoc.id).set(
        { ptoSummary: out.sentTo.length ? { lastSentYear: built.summary.year, lastResult } : { lastResult } },
        { merge: true },
      );
      results.push({ uid: userDoc.id, ...out });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  return res.status(200).json({ checked: true, sent: results.filter((r) => r.sentTo?.length).length, results });
}
