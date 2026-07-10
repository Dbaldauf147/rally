// Exports a date range of the user's Voting Calendar (civic election dates) as a
// per-day map, so Prep Day's Week Plan can pull them in alongside Rally events.
// Sources mirror VotingPage.jsx: hardcoded national elections + curated per-state
// dates (electionDates.js) + the user's custom dates (users/{uid}.voting). Auth is
// the same shared secret as plans-export.js (?key= matched to PLANS_EXPORT_KEY).
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getCuratedForState } from '../src/electionDates.js';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) {
    initializeApp({ credential: cert(sa) });
  }
}

const DEFAULT_EMAIL = 'baldaufdan@gmail.com';

// Type → display metadata, mirrored from VotingPage.jsx's TYPES so Prep Day can
// render the same icon/color without knowing the voting domain.
const TYPES = {
  general:      { icon: '🗳️', color: '#2563eb' },
  primary:      { icon: '🗳️', color: '#7c3aed' },
  registration: { icon: '⏰', color: '#dc2626' },
  early:        { icon: '🕑', color: '#0891b2' },
  ballot:       { icon: '✉️', color: '#d97706' },
  local:        { icon: '🏛️', color: '#16a34a' },
  other:        { icon: '📌', color: '#6b7280' },
};

// Fixed nationwide dates (mirror NATIONAL_EVENTS in VotingPage.jsx).
const NATIONAL_EVENTS = [
  { id: 'nat-2026', date: '2026-11-03', label: 'General Election — U.S. Midterms', type: 'general' },
  { id: 'nat-2028', date: '2028-11-07', label: 'General Election — Presidential', type: 'general' },
];

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expectedKey = process.env.PLANS_EXPORT_KEY;
  if (!expectedKey) {
    return res.status(200).json({ skipped: true, reason: 'No PLANS_EXPORT_KEY configured', eventsByDay: {} });
  }
  if ((req.query?.key || '').toString().trim() !== expectedKey.trim()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startStr = (req.query?.start || '').toString().trim();
  const endStr = (req.query?.end || '').toString().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endStr)) {
    return res.status(400).json({ error: 'start and end (YYYY-MM-DD) are required' });
  }
  if (endStr < startStr) {
    return res.status(400).json({ error: 'Invalid start/end range' });
  }

  const email = (req.query?.email || DEFAULT_EMAIL).toString().trim().toLowerCase();

  // The user's saved state + custom dates live on their Firestore user doc, but
  // national + curated dates don't need it — so a missing/unconfigured Firebase
  // still returns the universal dates rather than erroring.
  let stateCode = '';
  let custom = [];
  try {
    const db = getFirestore();
    const ownerUid = (await getAuth().getUserByEmail(email)).uid;
    const snap = await db.collection('users').doc(ownerUid).get();
    const voting = snap.exists ? (snap.data().voting || {}) : {};
    stateCode = (voting.state || '').toString();
    custom = Array.isArray(voting.customDates) ? voting.customDates.filter(x => x && x.date) : [];
  } catch {
    /* fall through with national-only dates */
  }

  // Assemble all events, dedupe national/curated by date|type (matches VotingPage).
  const curatedEntry = getCuratedForState(stateCode);
  const curated = curatedEntry ? curatedEntry.dates : [];
  const seen = new Set();
  const all = [];
  for (const e of [...NATIONAL_EVENTS, ...curated]) {
    const k = `${e.date}|${e.type}`;
    if (seen.has(k)) continue;
    seen.add(k);
    all.push(e);
  }
  for (const c of custom) all.push(c);

  const eventsByDay = {};
  for (const e of all) {
    const date = (e.date || '').toString();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (date < startStr || date > endStr) continue;
    const meta = TYPES[e.type] || TYPES.other;
    (eventsByDay[date] = eventsByDay[date] || []).push({
      id: e.id || `${date}-${e.type}`,
      title: e.label || 'Voting date',
      type: e.type || 'other',
      icon: meta.icon,
      color: meta.color,
    });
  }

  return res.status(200).json({ eventsByDay });
}
