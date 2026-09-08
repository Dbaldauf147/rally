// Wedding digest: a weekly email of the wedding checklist.
//
// The checklist is the job — sixty-odd tasks counting backward from the date —
// so the checklist is what the email is. The guest list used to be the whole
// message; it is one column of that job, and now rides along as a closing
// footnote.
//
// The list and the ticks are read out of the same user document the Wedding
// page writes, through the same module the page renders from, so the email can
// never disagree with the screen about what is done. Three entry points,
// matching api/sports-digest.js:
//   • GET  (Vercel Cron) — runs daily, sends to each enabled user on their
//     chosen weekday, deduped once per day.
//   • POST { uid, preview: true } — returns the HTML without sending.
//   • POST { uid } — "send test now", to the account's own address alone,
//     never the shared list.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { weddingStats, snapshotOf } from '../lib/weddingStats.js';
import { checklistSummary, checklistSnapshot, checklistDelta } from '../lib/weddingChecklistDigest.js';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) initializeApp({ credential: cert(sa) });
}

// Long lists get truncated rather than turning the email into the page it is
// summarising. Applies to the week's ticked-off tasks; the checklist proper is
// printed in full, because printing only some of a checklist is not one.
const MAX_NAMES = 15;

// A shared summary, not a mailing list. The cap is here so a pasted column of
// addresses can’t quietly turn the digest into one.
const MAX_RECIPIENTS = 10;

// These two mirror api/sports-digest.js. Kept local rather than shared because
// that file is a Vercel function and importing across api/ routes both.
function localDateKey(date, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

const WEEKDAY_IDX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localWeekday(date, tz) {
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', weekday: 'short' }).format(date);
    return WEEKDAY_IDX[s] ?? date.getUTCDay();
  } catch {
    return date.getUTCDay();
  }
}

function fmtWeekOf(date, tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'America/New_York', month: 'long', day: 'numeric',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

// Escaped everywhere the owner's own text reaches the HTML. Task wording is
// editable on the page and guest names are pasted from spreadsheets, so an
// apostrophe or an ampersand in "Bill & Laurie O'Neill" — or in a task someone
// retyped — shouldn't break the markup.
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// "+3" — the sign reads at a glance in a mail client that may not render colour
// the way it looks here.
function deltaChip(n) {
  if (!n) return '';
  const up = n > 0;
  const colour = up ? '#15803d' : '#b45309';
  return `<span style="margin-left:0.4rem;font-size:0.9rem;font-weight:700;color:${colour};">${up ? '+' : '−'}${Math.abs(n)}</span>`;
}

/* One task line.

   A finished task is struck through and greyed rather than dropped: half the
   point of a checklist is the sight of what is already behind you. Its note
   goes, though — the guidance was for doing it, and it is dead weight once the
   thing is done. */
function taskRow(task) {
  const colour = task.done ? '#9ca3af' : '#111827';
  const strike = task.done ? 'text-decoration:line-through;' : '';
  const flag = task.milestone && !task.done
    ? '<span style="margin-left:0.4rem;font-size:0.68rem;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:0.04em;">milestone</span>'
    : '';
  const note = task.note && !task.done
    ? `<div style="font-size:0.78rem;color:#6b7280;line-height:1.45;margin:0.15rem 0 0;">${esc(task.note)}</div>`
    : '';
  /* Two cells rather than two inline spans, so a task too long for one line
     hangs under its own text instead of wrapping back under the tick — and so
     it survives the mail clients that still lay out on tables and nothing
     else. The tick cell is top-aligned to stay level with the first line of a
     task that runs to three. */
  return `<table style="width:100%;border-collapse:collapse;margin:0 0 0.35rem;">
    <tr>
      <td style="width:1.1rem;vertical-align:top;padding:0;font-size:0.9rem;line-height:1.45;color:${task.done ? '#16a34a' : '#d1d5db'};font-weight:700;">${task.done ? '&#10003;' : '&#9744;'}</td>
      <td style="vertical-align:top;padding:0 0 0 0.5rem;">
        <div style="font-size:0.9rem;color:${colour};${strike}line-height:1.45;">${esc(task.text)}${flag}</div>${note}
      </td>
    </tr>
  </table>`;
}

/* One phase.

   A phase with everything ticked collapses to a single line. By the month of
   the wedding most of the list is behind you, and an email that prints forty
   struck-through tasks before reaching anything you can act on is an email
   nobody scrolls to the end of. */
function phaseBlock(section) {
  const when = section.when
    ? `<span style="color:#9ca3af;font-weight:400;"> · ${esc(section.when)}</span>`
    : '';
  if (section.total === 0) return '';
  if (section.finished) {
    return `<div style="margin:0 0 0.6rem;padding:0.5rem 0.75rem;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;font-size:0.85rem;color:#166534;">
      <strong>&#10003; ${esc(section.title)}</strong>${when} — all ${section.total} done
    </div>`;
  }
  return `<div style="margin:0 0 1.1rem;">
    <table style="width:100%;border-collapse:collapse;margin:0 0 0.5rem;">
      <tr>
        <td style="font-size:0.8rem;font-weight:700;color:#111827;padding:0 0 0.3rem;border-bottom:1px solid #e5e7eb;">${esc(section.title)}${when}</td>
        <td style="font-size:0.8rem;font-weight:600;color:#6b7280;text-align:right;padding:0 0 0.3rem;border-bottom:1px solid #e5e7eb;white-space:nowrap;">${section.complete}/${section.total}</td>
      </tr>
    </table>
    ${section.tasks.map(taskRow).join('')}
  </div>`;
}

/* The guest list, demoted to one line.

   It was the entire email once. It is one column of the job, and this is the
   width it deserves beside the rest of it. Absent altogether when nobody has
   been typed in yet, rather than printing a row of zeroes. */
function guestFootnote(stats) {
  if (!stats || stats.households === 0) return '';
  const ready = stats.missingAddress === 0
    ? 'every address is in'
    : `${stats.missingAddress} still without a mailable address`;
  return `<div style="margin:1.5rem 0 0;padding:0.7rem 1rem;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;font-size:0.85rem;color:#374151;line-height:1.6;">
    <strong>Guest list</strong> · ${stats.guests} guest${stats.guests === 1 ? '' : 's'} in ${stats.households} household${stats.households === 1 ? '' : 's'} · ${stats.mailable}/${stats.households} ready to mail, ${esc(ready)}
  </div>`;
}

// Exported for tests: the handler is the default export, so named exports here
// are invisible to Vercel's function routing.
export function buildEmailHtml(list, delta, tz, now, stats) {
  const sum = checklistSummary(list);

  const movement = delta
    ? (delta.any
      ? `<div style="margin:0 0 1.25rem;padding:0.85rem 1rem;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;">
          <h3 style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#166534;margin:0 0 0.5rem;">Done this week</h3>
          <div style="font-size:0.88rem;color:#14532d;line-height:1.7;">
            ${delta.ticked.slice(0, MAX_NAMES).map((t) => `&#10003; ${esc(t.text)}`).join('<br>')}
            ${delta.ticked.length > MAX_NAMES ? `<br><span style="color:#4d7c0f;">+${delta.ticked.length - MAX_NAMES} more</span>` : ''}
            ${delta.unticked > 0 ? `<br><span style="color:#a16207;">${delta.unticked} reopened</span>` : ''}
          </div>
        </div>`
      : '<p style="color:#9ca3af;margin:0 0 1.25rem;font-size:0.9rem;">Nothing ticked off since last week.</p>')
    : '<p style="color:#9ca3af;margin:0 0 1.25rem;font-size:0.9rem;">First digest — next week will show what you got done.</p>';

  const nextUpBlock = sum.next
    ? `<div style="margin:0 0 1.25rem;padding:0.85rem 1rem;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;">
        <h3 style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#1e40af;margin:0 0 0.3rem;">Next up</h3>
        <div style="font-size:1rem;font-weight:650;color:#1e3a8a;line-height:1.4;">${esc(sum.next.text)}</div>
        <div style="font-size:0.78rem;color:#3b82f6;margin-top:0.15rem;">${esc(sum.next.phaseTitle)}</div>
        ${sum.next.note ? `<div style="font-size:0.8rem;color:#1d4ed8;margin-top:0.4rem;line-height:1.5;">${esc(sum.next.note)}</div>` : ''}
      </div>`
    : `<div style="margin:0 0 1.25rem;padding:0.85rem 1rem;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;font-size:0.95rem;color:#166534;font-weight:650;">
        Every task on the checklist is done.
      </div>`;

  const milestones = sum.milestonesLeft.length > 0
    ? `<div style="margin:0 0 1.25rem;padding:0.85rem 1rem;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;">
        <h3 style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#92400e;margin:0 0 0.4rem;">Milestones still ahead</h3>
        <div style="font-size:0.88rem;color:#78350f;line-height:1.7;">
          ${sum.milestonesLeft.map((t) => esc(t.text)).join('<br>')}
        </div>
      </div>`
    : '';

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:1.5rem;color:#111827;">
    <h2 style="margin:0 0 0.15rem;font-size:1.35rem;">&#128141; Wedding checklist</h2>
    <p style="color:#6b7280;margin:0 0 1rem;font-size:0.9rem;">Week of ${esc(fmtWeekOf(now, tz))}</p>

    <div style="margin:0 0 1.25rem;">
      <div style="font-size:1.5rem;font-weight:700;color:#111827;line-height:1.1;">
        ${sum.complete} of ${sum.total} done${deltaChip(delta ? delta.ticked.length : 0)}
      </div>
      <div style="height:8px;background:#e5e7eb;border-radius:999px;overflow:hidden;margin-top:0.5rem;">
        <div style="height:8px;width:${sum.pct}%;background:#16a34a;"></div>
      </div>
      <div style="font-size:0.78rem;color:#6b7280;margin-top:0.3rem;">${sum.pct}% of the checklist complete</div>
    </div>

    ${nextUpBlock}
    ${movement}
    ${milestones}

    <h3 style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:1.5rem 0 0.75rem;">The whole list</h3>
    ${sum.sections.map(phaseBlock).join('')}

    ${guestFootnote(stats)}

    <p style="color:#9ca3af;font-size:0.75rem;margin-top:1.5rem;">
      From your Rally Wedding page. You're getting this because you turned on the weekly wedding digest.
    </p>
  </div>`;
}

/* Who the weekly summary goes to.
 *
 * One address was enough while this was your own list, but a wedding has two
 * people planning it, and the one who wants the "still missing an address"
 * line is often not the one who set the digest up.
 *
 * `emails` is the list. `email` is what single-recipient configs stored, and is
 * folded in so an existing setup keeps working without being re-saved —
 * de-duplicated case-insensitively, since for a while a config will hold the
 * same address in both fields. Falls back to the account's own address only
 * when the config names nobody, which is what makes switching the digest on a
 * one-click decision.
 */
export function digestRecipients(cfg = {}, fallback = '') {
  const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const out = [];
  const seen = new Set();
  for (const raw of [...(Array.isArray(cfg.emails) ? cfg.emails : []), cfg.email]) {
    const value = String(raw ?? '').trim();
    if (!isEmail(value) || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
  }
  if (out.length) return out.slice(0, MAX_RECIPIENTS);
  const own = String(fallback ?? '').trim();
  return isEmail(own) ? [own] : [];
}

/* Build a user's digest without sending it, so the page can preview exactly
   what would arrive. Returns { skipped } when there's nothing worth sending. */
export function buildDigestForUser(userData, now = new Date()) {
  const cfg = userData?.weddingDigest || {};
  const emails = digestRecipients(cfg, userData?.email);
  if (emails.length === 0) return { skipped: 'no email' };
  const email = emails[0];

  /* The checklist is the email, so the checklist is what decides there is
     something to send. This used to turn on the guest list, which meant a
     couple who hadn't typed a single guest in got nothing — while having the
     whole sixty-task list ahead of them, which is exactly when the weekly
     nudge is worth most. An empty checklist is a deliberately emptied one and
     still skips. */
  const list = userData?.weddingChecklist;
  const sum = checklistSummary(list);
  if (sum.total === 0) return { skipped: 'nothing on the wedding checklist' };

  const tz = cfg.timezone || 'America/New_York';
  // Still computed, for the footnote. Null rather than a row of zeroes when
  // nobody is on the list yet — an empty guest list is a real state, and not
  // one worth a paragraph.
  const contacts = Array.isArray(userData?.weddingContacts) ? userData.weddingContacts : [];
  const stats = contacts.length > 0 ? weddingStats(contacts) : null;

  const delta = checklistDelta(list, cfg.lastSnapshot?.checklist);
  const html = buildEmailHtml(list, delta, tz, now, stats);

  const subject = sum.finished
    ? '💍 Wedding checklist — everything is done'
    : `💍 Wedding checklist — ${sum.complete}/${sum.total} done${sum.next ? `, next: ${sum.next.text}` : ''}`;

  return {
    html,
    subject,
    email,
    emails,
    stats,
    sum,
    // Nested, so the checklist's snapshot and the guest list's both live in the
    // one field existing configs already carry.
    snapshot: {
      ...(stats ? snapshotOf(stats) : {}),
      checklist: checklistSnapshot(list),
    },
  };
}

/* Where a test send is allowed to go: the account's own address, and nothing
   else.

   The shared list is the point of the weekly digest — a wedding has two people
   planning it — but it is emphatically not the point of the Test button. That
   button exists to let you look at the thing before anyone else does, and a
   test that also mails your fiancée every time you want to check the wording
   is a button you stop pressing.

   Run through digestRecipients with an empty config so a malformed account
   address is rejected the same way any other address would be, and so this
   can only ever return one entry. */
export function testRecipients(userData) {
  return digestRecipients({}, userData?.email);
}

/* `to` overrides who it goes to; the cron leaves it out and gets the whole
   configured list. Kept as an argument rather than read off the config,
   because "who is this going to" is the one decision a send should never make
   for itself. */
async function sendDigestForUser(resendKey, uid, userData, now, to = null) {
  const built = buildDigestForUser(userData, now);
  if (built.skipped) return { uid, skipped: built.skipped };
  const emails = to || built.emails;
  if (!emails.length) return { uid, skipped: 'no email' };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Rally Wedding <noreply@resend.dev>',
      to: emails,
      subject: built.subject,
      html: built.html,
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return { uid, success: false, error: err.message || `HTTP ${response.status}` };
  }
  return {
    uid,
    success: true,
    done: built.sum.complete,
    total: built.sum.total,
    sentTo: emails,
    snapshot: built.snapshot,
  };
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

  // Preview first: it sends nothing, so it shouldn't need a mail provider.
  if (req.method === 'POST' && req.body?.preview) {
    const uid = req.body?.uid;
    if (!uid) return res.status(400).json({ error: 'uid required' });
    try {
      const snap = await db.collection('users').doc(uid).get();
      if (!snap.exists) return res.status(404).json({ error: 'user not found' });
      const built = buildDigestForUser(snap.data());
      if (built.skipped) return res.status(200).json({ skipped: built.skipped });
      return res.status(200).json({ html: built.html, subject: built.subject });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return res.status(200).json({ skipped: true, reason: 'No RESEND_API_KEY configured' });
  }

  /* "Send test now" — to the account's own address, and only there.

     Never an address out of the request body, and never the shared list
     either: this is the button you press to see the thing before anybody else
     does, and one that also mails whoever else is on the digest is a button
     nobody presses twice. */
  if (req.method === 'POST') {
    const uid = req.body?.uid;
    if (!uid) return res.status(400).json({ error: 'uid required' });
    try {
      const snap = await db.collection('users').doc(uid).get();
      if (!snap.exists) return res.status(404).json({ error: 'user not found' });
      const to = testRecipients(snap.data());
      if (!to.length) {
        return res.status(200).json({ sent: 0, skipped: 'no address on your account to send a test to' });
      }
      const result = await sendDigestForUser(resendKey, uid, snap.data(), new Date(), to);
      if (result.skipped) return res.status(200).json({ sent: 0, ...result });
      if (!result.success) return res.status(502).json(result);
      // Deliberately does NOT write lastSnapshot: a test send shouldn't consume
      // the week's movement and leave the real Sunday email saying "no change".
      return res.status(200).json({ sent: 1, ...result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Cron. Runs daily; each user's chosen weekday decides whether today is
  // theirs, matching how the sports digest handles frequency on the Hobby plan
  // where the cron fires once a day at a time we don't control.
  const now = new Date();
  const results = [];
  try {
    const usersSnap = await db.collection('users').get();
    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      const cfg = data.weddingDigest;
      if (!cfg?.enabled) continue;
      const wanted = typeof cfg.sendWeekday === 'number' ? cfg.sendWeekday : 0;
      if (localWeekday(now, cfg.timezone) !== wanted) continue;
      const todayKey = localDateKey(now, cfg.timezone);
      if (cfg.lastSentDate === todayKey) continue;
      const result = await sendDigestForUser(resendKey, userDoc.id, data, now);
      if (result.success) {
        // Snapshot saved only on a real send, so next week's "done this week"
        // is measured against the last email that actually went out.
        await db.collection('users').doc(userDoc.id).set(
          { weddingDigest: { lastSentDate: todayKey, lastSnapshot: result.snapshot } },
          { merge: true },
        );
      }
      results.push(result);
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const sent = results.filter((r) => r.success).length;
  return res.status(200).json({ checked: true, sent, total: results.length, results });
}
