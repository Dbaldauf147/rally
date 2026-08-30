// Wedding digest: a weekly email on where the guest list stands.
//
// The Wedding page holds one row per person, with no RSVP or task fields, so
// "status" here means list readiness — how many households you could actually
// post an invitation to, and who is still missing an address. Three entry
// points, matching api/sports-digest.js:
//   • GET  (Vercel Cron) — runs daily, sends to each enabled user on their
//     chosen weekday, deduped once per day.
//   • POST { uid, preview: true } — returns the HTML without sending.
//   • POST { uid } — "send test now", straight to the account's own address.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { weddingStats, statsDelta, snapshotOf } from '../lib/weddingStats.js';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) initializeApp({ credential: cert(sa) });
}

// Long lists get truncated rather than turning the email into the spreadsheet
// it is summarising.
const MAX_NAMES = 15;

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

// Escaped everywhere a guest's own text reaches the HTML — names and groups are
// typed by hand and pasted from spreadsheets, and an apostrophe or an ampersand
// in "Bill & Laurie O'Neill" shouldn't break the markup.
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// "+3" / "−1" / "" — the arrow reads at a glance in a mail client that may not
// render colour the way it looks here.
function deltaChip(n, { goodWhenUp = true } = {}) {
  if (!n) return '';
  const up = n > 0;
  const good = up === goodWhenUp;
  const colour = good ? '#15803d' : '#b45309';
  const sign = up ? '+' : '−';
  return `<span style="margin-left:0.4rem;font-size:0.8rem;font-weight:700;color:${colour};">${sign}${Math.abs(n)}</span>`;
}

function statCard(label, value, chip) {
  return `<td style="padding:0.75rem 1rem;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
    <div style="font-size:1.5rem;font-weight:700;color:#111827;line-height:1.1;">${value}${chip || ''}</div>
    <div style="font-size:0.75rem;color:#6b7280;margin-top:0.15rem;text-transform:uppercase;letter-spacing:0.04em;">${esc(label)}</div>
  </td>`;
}

function tallyBlock(title, rows, total) {
  if (!rows || rows.length === 0) return '';
  const body = rows.map((r) => {
    const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
    return `<tr>
      <td style="padding:0.3rem 0;font-size:0.88rem;color:#374151;">${esc(r.label)}</td>
      <td style="padding:0.3rem 0;font-size:0.88rem;color:#111827;font-weight:600;text-align:right;white-space:nowrap;">${r.count}<span style="color:#9ca3af;font-weight:400;"> · ${pct}%</span></td>
    </tr>`;
  }).join('');
  return `<div style="margin:0 0 1.25rem;">
    <h3 style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 0.4rem;">${esc(title)}</h3>
    <table style="width:100%;border-collapse:collapse;">${body}</table>
  </div>`;
}

// Exported for tests: the handler is the default export, so named exports here
// are invisible to Vercel's function routing.
export function buildEmailHtml(stats, delta, tz, now) {
  const pctReady = stats.households > 0 ? Math.round((stats.mailable / stats.households) * 100) : 0;

  const shown = stats.missingAddressNames.slice(0, MAX_NAMES);
  const rest = stats.missingAddressNames.length - shown.length;
  const missingBlock = stats.missingAddress > 0
    ? `<div style="margin:0 0 1.25rem;padding:0.85rem 1rem;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;">
        <h3 style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#92400e;margin:0 0 0.5rem;">
          ${stats.missingAddress} household${stats.missingAddress === 1 ? '' : 's'} without a mailable address
        </h3>
        <div style="font-size:0.88rem;color:#78350f;line-height:1.7;">
          ${shown.map((n) => esc(n)).join('<br>')}
          ${rest > 0 ? `<br><span style="color:#a16207;">+${rest} more</span>` : ''}
        </div>
      </div>`
    : `<div style="margin:0 0 1.25rem;padding:0.85rem 1rem;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;font-size:0.9rem;color:#166534;font-weight:600;">
        Every household has a full mailing address. The list is ready to post.
      </div>`;

  const movement = delta
    ? (delta.any
      ? `<p style="color:#525252;margin:0 0 1.25rem;font-size:0.9rem;">
           Since last week: ${[
    delta.guests ? `${delta.guests > 0 ? '+' : '−'}${Math.abs(delta.guests)} guest${Math.abs(delta.guests) === 1 ? '' : 's'}` : '',
    delta.mailable ? `${delta.mailable > 0 ? '+' : '−'}${Math.abs(delta.mailable)} ready to mail` : '',
    delta.missingAddress ? `${delta.missingAddress > 0 ? '+' : '−'}${Math.abs(delta.missingAddress)} missing an address` : '',
  ].filter(Boolean).join(' · ')}
         </p>`
      : '<p style="color:#9ca3af;margin:0 0 1.25rem;font-size:0.9rem;">No change since last week.</p>')
    : '<p style="color:#9ca3af;margin:0 0 1.25rem;font-size:0.9rem;">First digest — next week will show what changed.</p>';

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:1.5rem;color:#111827;">
    <h2 style="margin:0 0 0.15rem;font-size:1.35rem;">💍 Wedding guest list</h2>
    <p style="color:#6b7280;margin:0 0 1rem;font-size:0.9rem;">Week of ${esc(fmtWeekOf(now, tz))}</p>
    ${movement}

    <table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:0 0 1.25rem;">
      <tr>
        ${statCard('Guests', stats.guests, deltaChip(delta?.guests))}
        ${statCard('Households', stats.households, deltaChip(delta?.households))}
        ${statCard('Ready to mail', `${stats.mailable}<span style="font-size:0.9rem;color:#9ca3af;font-weight:400;">/${stats.households}</span>`, '')}
      </tr>
    </table>

    <div style="margin:0 0 1.25rem;">
      <div style="height:8px;background:#e5e7eb;border-radius:999px;overflow:hidden;">
        <div style="height:8px;width:${pctReady}%;background:#16a34a;"></div>
      </div>
      <div style="font-size:0.78rem;color:#6b7280;margin-top:0.3rem;">${pctReady}% of households ready to mail</div>
    </div>

    ${missingBlock}

    <div style="margin:0 0 1.25rem;padding:0.75rem 1rem;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;font-size:0.88rem;color:#374151;">
      <strong>${stats.missingEmail}</strong> guest${stats.missingEmail === 1 ? '' : 's'} with no email ·
      <strong>${stats.missingPhone}</strong> with no phone
    </div>

    ${tallyBlock('By group', stats.byGroup, stats.guests)}
    ${tallyBlock('By category', stats.byCategory, stats.guests)}

    <p style="color:#9ca3af;font-size:0.75rem;margin-top:1.5rem;">
      From your Rally Wedding page. You're getting this because you turned on the weekly wedding digest.
    </p>
  </div>`;
}

/* Build a user's digest without sending it, so the page can preview exactly
   what would arrive. Returns { skipped } when there's nothing worth sending. */
export function buildDigestForUser(userData, now = new Date()) {
  const cfg = userData?.weddingDigest || {};
  const email = cfg.email || userData?.email;
  if (!email) return { skipped: 'no email' };

  const contacts = Array.isArray(userData?.weddingContacts) ? userData.weddingContacts : [];
  if (contacts.length === 0) return { skipped: 'no contacts on the wedding list' };

  const tz = cfg.timezone || 'America/New_York';
  const stats = weddingStats(contacts);
  const delta = statsDelta(stats, cfg.lastSnapshot);
  const html = buildEmailHtml(stats, delta, tz, now);
  const subject = stats.missingAddress > 0
    ? `💍 Wedding list — ${stats.mailable}/${stats.households} households ready, ${stats.missingAddress} missing an address`
    : `💍 Wedding list — all ${stats.households} households ready to mail`;
  return { html, subject, email, stats, snapshot: snapshotOf(stats) };
}

async function sendDigestForUser(resendKey, uid, userData, now) {
  const built = buildDigestForUser(userData, now);
  if (built.skipped) return { uid, skipped: built.skipped };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Rally Wedding <noreply@resend.dev>',
      to: [built.email],
      subject: built.subject,
      html: built.html,
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return { uid, success: false, error: err.message || `HTTP ${response.status}` };
  }
  return { uid, success: true, guests: built.stats.guests, snapshot: built.snapshot };
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

  // "Send test now" — always to the account's own address, never one supplied
  // in the request body.
  if (req.method === 'POST') {
    const uid = req.body?.uid;
    if (!uid) return res.status(400).json({ error: 'uid required' });
    try {
      const snap = await db.collection('users').doc(uid).get();
      if (!snap.exists) return res.status(404).json({ error: 'user not found' });
      const result = await sendDigestForUser(resendKey, uid, snap.data(), new Date());
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
        // Snapshot saved only on a real send, so next week's "since last week"
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
