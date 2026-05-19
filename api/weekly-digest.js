// Vercel Cron: runs weekly on Sunday, emails a digest of events that don't
// have a finalized date yet (where the configured recipient is the owner).
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) {
    initializeApp({ credential: cert(sa) });
  }
}

const DEFAULT_RECIPIENT = 'baldaufdanwork@gmail.com';
const APP_URL = 'https://rally-seven-theta.vercel.app';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return res.status(200).json({ skipped: true, reason: 'No RESEND_API_KEY configured' });
  }

  const ownerFilter = (process.env.DIGEST_RECIPIENT_EMAIL || DEFAULT_RECIPIENT).toLowerCase();
  // Optional ?to=foo@bar.com override for sending a test copy to a different inbox.
  // The owner filter still uses DIGEST_RECIPIENT_EMAIL so the digest contents don't change.
  const toOverride = (req.query?.to || '').toString().trim().toLowerCase();
  const recipient = toOverride || ownerFilter;

  let db;
  try {
    db = getFirestore();
  } catch {
    return res.status(200).json({ skipped: true, reason: 'Firebase Admin not configured. Set FIREBASE_SERVICE_ACCOUNT env var.' });
  }

  let ownerUid;
  try {
    ownerUid = (await getAuth().getUserByEmail(ownerFilter)).uid;
  } catch {
    return res.status(200).json({ sent: false, reason: `No Firebase user for ${ownerFilter}` });
  }
  // Mirror the frontend sanitizeKey so we catch events where the user was invited
  // by email before signing up.
  const emailKey = ownerFilter.replace(/[.@#$/\[\]]/g, '_');

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
    const unscheduled = [];

    for (const eventDoc of eventsById.values()) {
      const event = eventDoc.data();
      if (event.stage === 'finalized') continue;

      const members = event.members || {};

      // Tally open date options and votes so the digest shows progress
      const dateOptsSnap = await db.collection('events').doc(eventDoc.id).collection('dateOptions').get();
      const openOpts = dateOptsSnap.docs.filter(d => !d.data().closed);
      const voterUids = new Set();
      for (const d of openOpts) {
        const votes = d.data().votes || {};
        for (const [uid, v] of Object.entries(votes)) {
          if (v.vote && v.vote !== 'none') voterUids.add(uid);
        }
      }
      const memberCount = Object.values(members).filter(m => m && typeof m === 'object' && !m.skipVote).length;

      unscheduled.push({
        id: eventDoc.id,
        title: event.title || 'Untitled event',
        location: event.location || '',
        dateOptionsCount: openOpts.length,
        voted: voterUids.size,
        memberCount,
        createdAt: event.createdAt?.toDate?.() || null,
      });
    }

    if (unscheduled.length === 0) {
      return res.status(200).json({ sent: false, reason: 'No unscheduled events', recipient });
    }

    unscheduled.sort((a, b) => {
      const at = a.createdAt?.getTime?.() || 0;
      const bt = b.createdAt?.getTime?.() || 0;
      return at - bt;
    });

    const rows = unscheduled.map(e => {
      const link = `${APP_URL}/event/${e.id}`;
      const meta = [
        e.location ? `📍 ${e.location}` : null,
        e.dateOptionsCount > 0
          ? `🗓 ${e.dateOptionsCount} date option${e.dateOptionsCount === 1 ? '' : 's'} · ${e.voted}/${e.memberCount} voted`
          : `🗓 No date options yet`,
      ].filter(Boolean).join(' &nbsp;·&nbsp; ');
      return `
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #eee;">
            <a href="${link}" style="font-size: 1rem; font-weight: 600; color: #1a1a1a; text-decoration: none;">${escapeHtml(e.title)}</a>
            <div style="color: #6b7280; font-size: 0.85rem; margin-top: 4px;">${meta}</div>
          </td>
        </tr>`;
    }).join('');

    const subject = `Rally: ${unscheduled.length} event${unscheduled.length === 1 ? '' : 's'} still need${unscheduled.length === 1 ? 's' : ''} a date`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 2rem;">
        <h1 style="font-size: 1.5rem; color: #4f46e5; margin: 0 0 0.25rem;">Rally weekly digest</h1>
        <p style="color: #525252; margin: 0 0 1.5rem;">${unscheduled.length} event${unscheduled.length === 1 ? '' : 's'} still waiting on a date.</p>
        <table style="width: 100%; border-collapse: collapse;">${rows}</table>
        <a href="${APP_URL}" style="display: inline-block; background: #4f46e5; color: #fff; padding: 0.6rem 1.25rem; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 1.5rem;">Open Rally</a>
        <p style="color: #9ca3af; font-size: 0.75rem; margin-top: 2rem;">Sent weekly on Sundays. Reply to unsubscribe.</p>
      </div>`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Rally <noreply@resend.dev>',
        to: [recipient],
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ sent: false, error: err.message || `HTTP ${response.status}` });
    }

    return res.status(200).json({ sent: true, recipient, count: unscheduled.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
