// Vercel Cron: runs daily, checks all events for due auto-reminders,
// and sends reminder emails to non-voters via the Resend API.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) {
    initializeApp({ credential: cert(sa) });
  }
}

export default async function handler(req, res) {
  // Only allow GET (Vercel Cron) or POST (manual trigger)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return res.status(200).json({ skipped: true, reason: 'No RESEND_API_KEY configured' });
  }

  let db;
  try {
    db = getFirestore();
  } catch {
    return res.status(200).json({ skipped: true, reason: 'Firebase Admin not configured. Set FIREBASE_SERVICE_ACCOUNT env var.' });
  }

  const now = new Date();
  const results = [];

  try {
    const eventsSnap = await db.collection('events').get();

    for (const eventDoc of eventsSnap.docs) {
      const event = eventDoc.data();
      const eventId = eventDoc.id;

      // Skip events without auto reminders enabled
      const ar = event.autoReminders;
      if (!ar?.enabled || !ar.startedAt || !Array.isArray(ar.intervals) || ar.intervals.length === 0) {
        continue;
      }

      const startedAt = new Date(ar.startedAt);
      const daysSinceStart = Math.floor((now - startedAt) / (1000 * 60 * 60 * 24));
      const members = event.members || {};

      // Get open date options to determine who has voted
      const dateOptsSnap = await db.collection('events').doc(eventId).collection('dateOptions').get();
      const openOpts = dateOptsSnap.docs.filter(d => !d.data().closed);
      const voterUids = new Set();
      for (const d of openOpts) {
        const votes = d.data().votes || {};
        for (const [uid, v] of Object.entries(votes)) {
          if (v.vote && v.vote !== 'none') voterUids.add(uid);
        }
      }

      // Find non-voters with emails
      for (const [uid, m] of Object.entries(members)) {
        if (!m || typeof m !== 'object') continue;
        if (!m.email) continue;
        if (m.skipVote) continue;
        if (voterUids.has(uid)) continue; // already voted

        const sent = m.autoRemindersSent || 0;
        if (sent >= ar.intervals.length) continue; // all reminders already sent

        // Check if it's time for the next reminder
        const nextInterval = ar.intervals[sent]; // days after startedAt
        if (daysSinceStart < nextInterval) continue; // not yet time

        // Send the reminder email
        const reminderNum = sent + 1;
        const totalReminders = ar.intervals.length;
        const isLast = reminderNum === totalReminders;
        const pollLink = `https://rally-seven-theta.vercel.app/poll/${eventId}?name=${encodeURIComponent(m.name || 'Friend')}`;
        const fromName = (() => {
          const owner = Object.entries(members).find(([, m2]) => m2?.role === 'owner');
          return owner?.[1]?.name || 'Someone';
        })();

        const subject = isLast
          ? `Final reminder: ${fromName} needs your vote on ${event.title}`
          : `Reminder ${reminderNum}/${totalReminders}: ${fromName} is waiting for your vote on ${event.title}`;

        const urgencyText = isLast
          ? `<p style="color: #dc2626; font-weight: 600;">This is a final reminder — please respond so we can finalize plans!</p>`
          : `<p style="color: #525252;">We haven't heard from you yet (reminder ${reminderNum} of ${totalReminders}). Please take a moment to vote on dates so we can finalize plans.</p>`;

        try {
          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Rally <noreply@resend.dev>',
              to: [m.email],
              subject,
              html: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 2rem;">
                  <h1 style="font-size: 1.5rem; color: #4f46e5; margin: 0 0 0.5rem;">Rally</h1>
                  <p style="color: #525252; margin: 0 0 1rem;">Hey${m.name ? ` ${m.name}` : ''}! 👋</p>
                  ${urgencyText}
                  <div style="background: #f5f3ef; border-radius: 12px; padding: 1.5rem; margin: 1rem 0;">
                    <h2 style="font-size: 1.2rem; margin: 0 0 0.5rem; color: #1a1a1a;">${event.title}</h2>
                    ${event.location ? `<p style="color: #525252; margin: 0;">📍 ${event.location}</p>` : ''}
                  </div>
                  <a href="${pollLink}" style="display: inline-block; background: #4f46e5; color: #fff; padding: 0.75rem 2rem; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 0.5rem;">Vote Now</a>
                  <p style="color: #9ca3af; font-size: 0.75rem; margin-top: 2rem;">Reminder ${reminderNum} of ${totalReminders}. If you didn't expect this email, you can safely ignore it.</p>
                </div>
              `,
            }),
          });

          if (response.ok) {
            // Update the member's reminder count in Firestore
            await db.collection('events').doc(eventId).update({
              [`members.${uid}.autoRemindersSent`]: sent + 1,
              [`members.${uid}.lastAutoReminder`]: now.toISOString(),
            });
            results.push({ event: event.title, member: m.name || uid, reminder: reminderNum, success: true });
          } else {
            const err = await response.json().catch(() => ({}));
            results.push({ event: event.title, member: m.name || uid, reminder: reminderNum, success: false, error: err.message || `HTTP ${response.status}` });
          }
        } catch (err) {
          results.push({ event: event.title, member: m.name || uid, reminder: reminderNum, success: false, error: err.message });
        }
      }
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const sent = results.filter(r => r.success).length;
  return res.status(200).json({ checked: true, sent, total: results.length, results });
}
