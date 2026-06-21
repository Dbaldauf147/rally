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

const DEFAULT_RECIPIENT = 'baldaufdan@gmail.com';
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

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    for (const eventDoc of eventsById.values()) {
      const event = eventDoc.data();
      if (event.stage === 'finalized') continue;
      if (event.cancelled) continue; // cancelled events shouldn't nag for a date

      const members = event.members || {};

      const dateOptsSnap = await db.collection('events').doc(eventDoc.id).collection('dateOptions').get();
      const openOpts = dateOptsSnap.docs
        .map(d => d.data())
        .filter(d => !d.closed && !d.noVote);

      // Earliest start across open options that hasn't already passed
      let closestStart = null;
      for (const opt of openOpts) {
        if (!opt.startDate) continue;
        const start = new Date(opt.startDate + 'T00:00:00');
        if (isNaN(start) || start < startOfToday) continue;
        if (!closestStart || start < closestStart) closestStart = start;
      }
      const daysOut = closestStart
        ? Math.round((closestStart - startOfToday) / (1000 * 60 * 60 * 24))
        : null;

      // Per-uid count of open options they've voted on (anything but 'none')
      const userOpenVoteCount = {};
      for (const opt of openOpts) {
        const votes = opt.votes || {};
        for (const [uid, v] of Object.entries(votes)) {
          if (v?.vote && v.vote !== 'none') {
            userOpenVoteCount[uid] = (userOpenVoteCount[uid] || 0) + 1;
          }
        }
      }

      // Voting members = anyone in members{} who isn't skipVote and isn't a null marker
      const votingMembers = Object.entries(members).filter(
        ([, m]) => m && typeof m === 'object' && !m.skipVote
      );
      const totalVoters = votingMembers.length;
      const fullyVotedUids = new Set(
        votingMembers
          .filter(([uid]) => openOpts.length > 0 && (userOpenVoteCount[uid] || 0) >= openOpts.length)
          .map(([uid]) => uid)
      );
      const waitingOn = votingMembers
        .filter(([uid]) => !fullyVotedUids.has(uid))
        .map(([, m]) => m.name || m.email || 'Unnamed');

      unscheduled.push({
        id: eventDoc.id,
        title: event.title || 'Untitled event',
        location: event.location || '',
        dateOptionsCount: openOpts.length,
        daysOut,
        closestStart,
        votedCount: fullyVotedUids.size,
        totalVoters,
        waitingOn,
        createdAt: event.createdAt?.toDate?.() || null,
      });
    }

    if (unscheduled.length === 0) {
      return res.status(200).json({ sent: false, reason: 'No unscheduled events', recipient });
    }

    // Sort: events with a closest date first (soonest first), then no-date events by createdAt
    unscheduled.sort((a, b) => {
      if (a.daysOut != null && b.daysOut != null) return a.daysOut - b.daysOut;
      if (a.daysOut != null) return -1;
      if (b.daysOut != null) return 1;
      const at = a.createdAt?.getTime?.() || 0;
      const bt = b.createdAt?.getTime?.() || 0;
      return at - bt;
    });

    const cellStyle = 'padding: 10px 12px; border-bottom: 1px solid #eee; vertical-align: top; font-size: 0.88rem; color: #1f2937;';
    const headStyle = 'padding: 10px 12px; border-bottom: 2px solid #d1d5db; text-align: left; font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; background: #f9fafb;';

    const formatDate = (d) =>
      d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '—';
    const formatDaysOut = (n) => {
      if (n == null) return '<span style="color:#9ca3af;">no upcoming option</span>';
      if (n === 0) return '<strong style="color:#dc2626;">today</strong>';
      if (n === 1) return '<strong style="color:#dc2626;">tomorrow</strong>';
      const color = n <= 7 ? '#dc2626' : n <= 30 ? '#d97706' : '#1f2937';
      return `<strong style="color:${color};">${n} day${n === 1 ? '' : 's'}</strong>`;
    };

    const rows = unscheduled.map(e => {
      const link = `${APP_URL}/event/${e.id}`;
      const titleCell = `
        <a href="${link}" style="font-weight:600; color:#1a1a1a; text-decoration:none;">${escapeHtml(e.title)}</a>
        ${e.location ? `<div style="color:#6b7280; font-size:0.78rem; margin-top:2px;">📍 ${escapeHtml(e.location)}</div>` : ''}`;
      const dateCell = e.closestStart
        ? `${formatDaysOut(e.daysOut)}<div style="color:#6b7280; font-size:0.78rem; margin-top:2px;">${escapeHtml(formatDate(e.closestStart))}</div>`
        : (e.dateOptionsCount === 0
          ? '<span style="color:#9ca3af;">No date options yet</span>'
          : formatDaysOut(null));
      const voteCell = e.totalVoters > 0
        ? `${e.votedCount}/${e.totalVoters} <span style="color:#6b7280;">voted on all</span>`
        : '<span style="color:#9ca3af;">No members</span>';
      const waitingCell = e.waitingOn.length === 0
        ? '<span style="color:#16a34a;">Everyone voted ✓</span>'
        : escapeHtml(e.waitingOn.join(', '));
      return `
        <tr>
          <td style="${cellStyle}">${titleCell}</td>
          <td style="${cellStyle}">${dateCell}</td>
          <td style="${cellStyle} white-space: nowrap;">${voteCell}</td>
          <td style="${cellStyle} color:#374151;">${waitingCell}</td>
        </tr>`;
    }).join('');

    const subject = `Rally: ${unscheduled.length} event${unscheduled.length === 1 ? '' : 's'} still need${unscheduled.length === 1 ? 's' : ''} a date`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 760px; margin: 0 auto; padding: 2rem;">
        <h1 style="font-size: 1.5rem; color: #4f46e5; margin: 0 0 0.25rem;">Rally weekly digest</h1>
        <p style="color: #525252; margin: 0 0 1.5rem;">${unscheduled.length} event${unscheduled.length === 1 ? '' : 's'} still waiting on a date.</p>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr>
              <th style="${headStyle}">Event</th>
              <th style="${headStyle}">Closest date</th>
              <th style="${headStyle}">Voted</th>
              <th style="${headStyle}">Waiting on</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <a href="${APP_URL}" style="display: inline-block; background: #4f46e5; color: #fff; padding: 0.6rem 1.25rem; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 1.5rem;">Open Rally</a>
        <div style="margin-top: 1.5rem; padding: 0.9rem 1rem; background: #eef2ff; border-left: 3px solid #4f46e5; border-radius: 6px; color: #1f2937; font-size: 0.82rem; line-height: 1.45;">
          <strong>✈️ Flight booking tip:</strong> Best time to book is <strong>30–45 days out</strong> for domestic flights and <strong>3–6 months out</strong> for international.
        </div>
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
