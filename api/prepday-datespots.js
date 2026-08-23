// Bridges Prep Day's "want to try" date spots into Rally's Plans page.
//
// The two apps live in different Firebase projects — Rally in rally-bd41a,
// Prep Day in sunday-routine — so the browser can't read one from the other.
// This endpoint holds both credentials: it verifies the caller's Rally ID
// token, then reads the Prep Day user's restaurants with a service account for
// that project. Everything is opt-in via env vars; with none configured it
// answers with an empty list so an un-wired deploy degrades to "no card".
//
//   PREPDAY_FIREBASE_SERVICE_ACCOUNT  service account JSON for sunday-routine
//   PREPDAY_USER_EMAIL                which Prep Day account to read (optional)
//   FIREBASE_SERVICE_ACCOUNT          Rally's own, already used elsewhere
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const DEFAULT_PREPDAY_EMAIL = 'baldaufdan@gmail.com';
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

// Rally's own project, on the default app — matches the other endpoints.
function rallyApp() {
  if (!getApps().some(a => a.name === '[DEFAULT]')) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (!sa.project_id) return null;
    initializeApp({ credential: cert(sa) });
  }
  return getApp();
}

// Prep Day's project, on a named app so it never collides with Rally's.
function prepdayApp() {
  const existing = getApps().find(a => a.name === 'prepday');
  if (existing) return existing;
  const sa = JSON.parse(process.env.PREPDAY_FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!sa.project_id) return null;
  return initializeApp({ credential: cert(sa) }, 'prepday');
}

// A spot counts as a date spot when one of its free-form voting categories
// mentions "date" — "date spots", "date night", however it got typed.
function isDateSpot(r) {
  return (r?.categories || []).some(c => /date/i.test(String(c || '')));
}

// Prep Day ranks "where do I want to go next" with an up/down vote score.
// Highest first, then alphabetical so the list is stable between calls.
function byPriority(a, b) {
  const va = typeof a.votes === 'number' ? a.votes : 0;
  const vb = typeof b.votes === 'number' ? b.votes : 0;
  if (va !== vb) return vb - va;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const prepday = prepdayApp();
  if (!prepday) {
    return res.status(200).json({ spots: [], skipped: true, reason: 'No PREPDAY_FIREBASE_SERVICE_ACCOUNT configured' });
  }

  // The response carries someone's personal list, so it needs a signed-in
  // Rally user — not just knowledge of the URL.
  const rally = rallyApp();
  if (!rally) {
    return res.status(500).json({ error: 'Rally credentials are not configured' });
  }
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  try {
    await getAuth(rally).verifyIdToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.parseInt(req.query?.limit, 10) || DEFAULT_LIMIT),
  );
  const email = (process.env.PREPDAY_USER_EMAIL || DEFAULT_PREPDAY_EMAIL).trim();

  try {
    const prepUser = await getAuth(prepday).getUserByEmail(email);
    const snap = await getFirestore(prepday).doc(`users/${prepUser.uid}`).get();
    const restaurants = snap.exists ? snap.get('restaurants') : null;
    if (!Array.isArray(restaurants)) {
      return res.status(200).json({ spots: [], reason: 'No restaurants on the Prep Day account' });
    }

    const spots = restaurants
      .filter(r => r && r.status === 'want-to-try' && isDateSpot(r))
      .sort(byPriority)
      .slice(0, limit)
      // Only what the Plans card renders — no notes, ratings, or coordinates.
      .map(r => ({
        id: r.id,
        name: r.name || '',
        url: r.url || '',
        address: r.address || '',
        dish: r.dish || '',
        categories: r.categories || [],
      }));

    return res.status(200).json({ spots, total: spots.length });
  } catch (err) {
    if (err?.code === 'auth/user-not-found') {
      return res.status(200).json({ spots: [], reason: `No Prep Day account for ${email}` });
    }
    return res.status(500).json({ error: err?.message || 'Could not read Prep Day' });
  }
}
