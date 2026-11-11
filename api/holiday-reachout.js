// Vercel Cron: runs each morning (0 14 * * * UTC — 9am ET in winter, 10am in
// summer). For every user, finds the holidays that begin today on their
// Holidays list and the contacts they tagged with one on the Friends pop-up,
// and sends one notification naming who to reach out to: a push to their
// devices, or an email when no device is registered for push.
//
// Runs once per user per day: `holidayReachOutSent` on the user doc records
// the day it last sent, so a manual re-run doesn't notify twice.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { apnsConfig, apnsSender } from '../lib/apns.js';
import { sendOne, mailConfigured } from '../lib/mailer.js';
import { holidayListFrom, holidaysStartingOn, holidayReachOutsOn, holidayReachOutMessage } from '../src/lib/holidayReachOut.js';

if (!getApps().length) {
  const sa = JSON.parse(globalThis.process?.env?.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) {
    initializeApp({ credential: cert(sa) });
  }
}

const APP_URL = 'https://rally-seven-theta.vercel.app';

// Today's date (YYYY-MM-DD) in the user's zone — the cron runs in UTC.
function dateKeyInTz(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderEmail(groups) {
  const sections = groups.map((g) => `
    <h3 style="margin:18px 0 6px;font-size:16px;">${esc(g.holiday.name)}</h3>
    <ul style="margin:0;padding-left:20px;">${g.friends.map((f) => `<li>${esc(f.name)}${f.phone ? ` · ${esc(f.phone)}` : ''}</li>`).join('')}</ul>`).join('');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#222;">
    <p style="font-size:15px;">You asked to be reminded to reach out to these people today:</p>
    ${sections}
    <p style="margin-top:22px;"><a href="${APP_URL}/reachout" style="color:#4f46e5;">Open Reach Out</a></p>
  </div>`;
}

export default async function handler(req, res) {
  // GET = Vercel Cron; POST = manual trigger.
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let db;
  try {
    db = getFirestore();
  } catch {
    return res.status(200).json({ skipped: true, reason: 'Firebase Admin not configured. Set FIREBASE_SERVICE_ACCOUNT.' });
  }

  const todayK = dateKeyInTz('America/New_York');
  const apns = apnsConfig();
  const sender = apns ? apnsSender(apns) : null;
  const canMail = mailConfigured();
  const results = [];

  try {
    const usersSnap = await db.collection('users').get();
    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      if (data.holidayReachOutSent === todayK) continue;

      const list = holidayListFrom(data.holidayList);
      const todays = holidaysStartingOn(list, todayK);
      if (todays.length === 0) continue;

      // Only the friends tagged with one of today's holidays (at most 30 ids
      // per array-contains-any — far more holidays than ever start on one day).
      const ids = todays.map((h) => h.id).slice(0, 30);
      const friendsSnap = await userDoc.ref.collection('friends').where('holidayTags', 'array-contains-any', ids).get();
      const friends = friendsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const groups = holidayReachOutsOn(friends, list, todayK);
      const msg = holidayReachOutMessage(groups);
      if (!msg) continue;

      const tokens = data.pushTokens && typeof data.pushTokens === 'object' ? Object.keys(data.pushTokens) : [];
      let delivered = false;
      const stale = [];

      if (sender && tokens.length) {
        const payload = { aps: { alert: { title: msg.title, body: msg.body }, sound: 'default' } };
        for (const token of tokens) {
          try {
            const r = await sender.send(token, payload);
            if (r.ok) delivered = true;
            if (r.stale) stale.push(token);
            results.push({ uid: userDoc.id, via: 'push', token: token.slice(0, 8), ok: r.ok, status: r.status, ...(r.reason ? { reason: r.reason } : {}) });
          } catch (err) {
            results.push({ uid: userDoc.id, via: 'push', token: token.slice(0, 8), ok: false, error: err.message });
          }
        }
      }

      // No phone reached — email instead, so the reminder isn't lost.
      if (!delivered && canMail && data.email) {
        const mail = await sendOne({ to: data.email, subject: msg.title, html: renderEmail(groups), fromName: 'Rally' });
        delivered = mail.ok;
        results.push({ uid: userDoc.id, via: 'email', ok: mail.ok, ...(mail.error ? { error: mail.error } : {}) });
      }

      const patch = {};
      if (delivered) patch.holidayReachOutSent = todayK;
      for (const t of stale) patch[`pushTokens.${t}`] = FieldValue.delete();
      if (Object.keys(patch).length) {
        try { await userDoc.ref.update(patch); } catch { /* best-effort */ }
      }
      if (!delivered && results.every((r) => r.uid !== userDoc.id)) {
        results.push({ uid: userDoc.id, ok: false, reason: 'No push device and no email provider' });
      }
    }
  } catch (err) {
    sender?.close();
    return res.status(500).json({ error: err.message });
  }

  sender?.close();
  const sent = results.filter((r) => r.ok).length;
  return res.status(200).json({ ran: true, today: todayK, sent, total: results.length, results });
}
