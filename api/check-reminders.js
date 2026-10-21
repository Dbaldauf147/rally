// Vercel Cron: runs daily, checks all events for due auto-reminders,
// and emails anyone with a date still unanswered — showing their answers so
// far — through lib/mailer.js (Gmail, else Resend).
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { sendOne, mailConfigured } from '../lib/mailer.js';
import { readyToStartReminders, remindableMembers, pollOptions, reminderAnswers } from '../src/lib/autoReminders.js';
import { renderReminderEmail } from '../lib/reminderEmail.js';

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

  if (!mailConfigured()) {
    return res.status(200).json({ skipped: true, reason: 'No email provider configured' });
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

      // Cancelled events shouldn't send reminders, and once a date is chosen
      // there's nothing left to vote on.
      if (event.cancelled || event.stage === 'finalized') continue;

      // Skip events without auto reminders enabled
      const ar = event.autoReminders;
      if (!ar?.enabled || !Array.isArray(ar.intervals) || ar.intervals.length === 0) {
        continue;
      }

      const members = event.members || {};
      // Who can be emailed at all (lib/autoReminders.js) — the weekly digest
      // works out the next send from the same rules.
      const remindable = remindableMembers(event);

      // The dates guests are asked about, to see who still has one unanswered
      const dateOptsSnap = await db.collection('events').doc(eventId).collection('dateOptions').get();
      const openOpts = pollOptions(dateOptsSnap.docs.map(d => d.data()));

      // Switched on at creation, the schedule waits with no startedAt until the
      // poll is something guests can answer; today it starts, and the first
      // reminder is counted from here.
      if (!ar.startedAt) {
        const emailableCount = remindable.filter(([, m]) => m.role !== 'owner').length;
        if (readyToStartReminders(event, { openOptionCount: openOpts.length, emailableCount })) {
          await db.collection('events').doc(eventId).update({ 'autoReminders.startedAt': now.toISOString() });
          results.push({ event: event.title, started: true });
        }
        continue;
      }

      const startedAt = new Date(ar.startedAt);
      const daysSinceStart = Math.floor((now - startedAt) / (1000 * 60 * 60 * 24));

      // Anyone with an email and at least one date unanswered
      for (const [uid, m] of remindable) {
        const answers = reminderAnswers(uid, openOpts);
        if (!answers.some(a => !a.vote)) continue; // answered every date

        const sent = m.autoRemindersSent || 0;
        if (sent >= ar.intervals.length) continue; // all reminders already sent

        // Check if it's time for the next reminder
        const nextInterval = ar.intervals[sent]; // days after startedAt
        if (daysSinceStart < nextInterval) continue; // not yet time

        // Send the reminder email
        const reminderNum = sent + 1;
        const totalReminders = ar.intervals.length;
        // Addressed to this member alone, so pin it with their member key — the
        // poll page keys their votes to it instead of minting a duplicate person.
        const pollLink = `https://rally-seven-theta.vercel.app/poll/${eventId}?name=${encodeURIComponent(m.name || 'Friend')}&vid=${encodeURIComponent(uid)}`;
        const fromName = (() => {
          const owner = Object.entries(members).find(([, m2]) => m2?.role === 'owner');
          return owner?.[1]?.name || 'Someone';
        })();

        const { subject, html } = renderReminderEmail({
          name: m.name, eventTitle: event.title, location: event.location,
          answers, pollLink, reminderNum, totalReminders, fromName,
        });

        try {
          const mail = await sendOne({ to: m.email, subject, html, fromName: 'Rally' });

          if (mail.ok) {
            // Update the member's reminder count in Firestore
            await db.collection('events').doc(eventId).update({
              [`members.${uid}.autoRemindersSent`]: sent + 1,
              [`members.${uid}.lastAutoReminder`]: now.toISOString(),
              // Every send, for the dates column in the vote table.
              [`members.${uid}.autoReminderLog`]: FieldValue.arrayUnion(now.toISOString()),
            });
            results.push({ event: event.title, member: m.name || uid, reminder: reminderNum, success: true });
          } else {
            results.push({ event: event.title, member: m.name || uid, reminder: reminderNum, success: false, error: mail.error });
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
