// Sports digest: emails a user their followed teams' recent scores + upcoming
// games. Two entry points:
//   • GET  (Vercel Cron) — daily run; sends to every user with sportsConfig
//     enabled who hasn't been sent today. On the Hobby plan the cron fires once
//     a day, so the per-user send-time is stored but not enforced to the hour.
//   • POST { uid, test: true } — "Send test now" button; sends that user's
//     digest immediately to their own account email, ignoring the daily dedupe.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) initializeApp({ credential: cert(sa) });
}

// YYYY-MM-DD in a given IANA timezone (defaults to US Eastern).
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

function fmtGameTime(iso, tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'America/New_York',
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

// Fetch one team's schedule and split into recent results + upcoming games.
async function fetchTeamDigest(team, tz) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${team.sportPath}/teams/${team.teamId}/schedule`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  const data = await res.json();
  const now = Date.now();
  const DAY = 86400000;

  const results = [];
  const upcoming = [];
  for (const ev of data.events || []) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const when = new Date(ev.date).getTime();
    const completed = !!comp.status?.type?.completed;
    const competitors = (comp.competitors || []).map((c) => ({
      abbrev: c.team?.abbreviation || c.team?.shortDisplayName || '?',
      name: c.team?.shortDisplayName || c.team?.displayName || '',
      home: c.homeAway === 'home',
      score: c.score?.displayValue ?? (c.score != null ? String(c.score) : ''),
      winner: !!c.winner,
    }));
    if (completed && when >= now - 3 * DAY) {
      results.push({ when, competitors });
    } else if (!completed && when >= now - 6 * 3600000) {
      upcoming.push({ when, iso: ev.date, competitors });
    }
  }
  results.sort((a, b) => a.when - b.when);
  upcoming.sort((a, b) => a.when - b.when);
  return {
    name: team.name,
    results,
    upcoming: upcoming.slice(0, 3),
  };
}

function resultLine(g) {
  // Show "AWAY 3 — HOME 5" with the winner bolded.
  const away = g.competitors.find((c) => !c.home) || g.competitors[0];
  const home = g.competitors.find((c) => c.home) || g.competitors[1];
  const side = (c) =>
    c ? `<span style="font-weight:${c.winner ? 700 : 400};">${c.abbrev} ${c.score}</span>` : '';
  return `${side(away)} <span style="color:#9ca3af;">—</span> ${side(home)}`;
}

function upcomingLine(g, tz) {
  const away = g.competitors.find((c) => !c.home) || g.competitors[0];
  const home = g.competitors.find((c) => c.home) || g.competitors[1];
  const matchup = `${away?.abbrev || '?'} @ ${home?.abbrev || '?'}`;
  return `<span style="font-weight:600;">${matchup}</span> <span style="color:#6b7280;">· ${fmtGameTime(g.iso, tz)}</span>`;
}

function buildEmailHtml(teamDigests, tz) {
  const sections = teamDigests
    .map((t) => {
      const resultsHtml = t.results.length
        ? t.results.map((g) => `<div style="margin:2px 0;color:#1f2937;">${resultLine(g)}</div>`).join('')
        : '<div style="color:#9ca3af;">No games in the last few days.</div>';
      const upcomingHtml = t.upcoming.length
        ? t.upcoming.map((g) => `<div style="margin:2px 0;color:#1f2937;">${upcomingLine(g, tz)}</div>`).join('')
        : '<div style="color:#9ca3af;">No upcoming games scheduled.</div>';
      return `
        <div style="background:#f5f3ef;border-radius:12px;padding:1rem 1.25rem;margin:0 0 1rem;">
          <h2 style="font-size:1.05rem;margin:0 0 0.5rem;color:#111827;">${t.name}</h2>
          <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:0.15rem;">Recent scores</div>
          ${resultsHtml}
          <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0.6rem 0 0.15rem;">Upcoming</div>
          ${upcomingHtml}
        </div>`;
    })
    .join('');

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:2rem;">
      <h1 style="font-size:1.5rem;color:#4f46e5;margin:0 0 0.25rem;">Rally Sports</h1>
      <p style="color:#525252;margin:0 0 1.25rem;">Your daily rundown 🏟️</p>
      ${sections}
      <p style="color:#9ca3af;font-size:0.75rem;margin-top:1.5rem;">Scores &amp; schedules via ESPN. You're getting this because you set up a Sports digest in Rally.</p>
    </div>`;
}

async function sendDigestForUser(db, resendKey, uid, userData) {
  const cfg = userData.sportsConfig || {};
  const email = cfg.email || userData.email;
  const teams = Array.isArray(cfg.teams) ? cfg.teams : [];
  if (!email) return { uid, skipped: 'no email' };
  if (teams.length === 0) return { uid, skipped: 'no teams' };

  const tz = cfg.timezone || 'America/New_York';
  const digests = [];
  for (const team of teams) {
    try {
      digests.push(await fetchTeamDigest(team, tz));
    } catch (err) {
      digests.push({ name: team.name, results: [], upcoming: [], error: err.message });
    }
  }

  const html = buildEmailHtml(digests, tz);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Rally Sports <noreply@resend.dev>',
      to: [email],
      subject: `🏟️ Your Sports digest — ${teams.length} team${teams.length === 1 ? '' : 's'}`,
      html,
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return { uid, success: false, error: err.message || `HTTP ${response.status}` };
  }
  return { uid, success: true, teams: teams.length };
}

export default async function handler(req, res) {
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
    return res.status(200).json({ skipped: true, reason: 'Firebase Admin not configured.' });
  }

  // Manual "send test now" — sends one user's digest immediately to their own
  // account email (never an address from the request), bypassing the dedupe.
  if (req.method === 'POST') {
    const uid = req.body?.uid;
    if (!uid) return res.status(400).json({ error: 'uid required' });
    try {
      const snap = await db.collection('users').doc(uid).get();
      if (!snap.exists) return res.status(404).json({ error: 'user not found' });
      const result = await sendDigestForUser(db, resendKey, uid, snap.data());
      if (result.skipped) return res.status(200).json({ sent: 0, ...result });
      if (!result.success) return res.status(502).json(result);
      return res.status(200).json({ sent: 1, ...result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Cron: daily digest for every enabled user not already sent today.
  const now = new Date();
  const results = [];
  try {
    const usersSnap = await db.collection('users').get();
    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      const cfg = data.sportsConfig;
      if (!cfg?.enabled) continue;
      const todayKey = localDateKey(now, cfg.timezone);
      if (cfg.lastSentDate === todayKey) continue; // already sent today
      const result = await sendDigestForUser(db, resendKey, userDoc.id, data);
      if (result.success) {
        await db.collection('users').doc(userDoc.id).set(
          { sportsConfig: { lastSentDate: todayKey } },
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
