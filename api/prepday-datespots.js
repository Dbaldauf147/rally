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

// "Date Nights" is a BUCKET in Prep Day, not a free-form category — it sits in
// the same row as Breakfast and Lunch/Dinner, and the list is user-editable at
// users/{uid}.eatingOutBuckets. Everything below mirrors that app's own
// matching so this endpoint and its filter chip always agree.

// The seed list Prep Day falls back to before the user saves their own.
const DEFAULT_BUCKETS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch-dinner', label: 'Lunch/Dinner' },
  { key: 'drinking', label: 'Drinking' },
  { key: 'coffee', label: 'Coffee' },
  { key: 'going-out', label: 'Going Out' },
];

// Mirrors sanitizeBucketConfig + effectiveBucketConfig: keep well-formed
// {key,label} entries, drop blanks and duplicates, fall back to the seed.
function effectiveBuckets(list) {
  const seen = new Set();
  const out = [];
  if (Array.isArray(list)) {
    for (const b of list) {
      if (!b || typeof b !== 'object') continue;
      const key = typeof b.key === 'string' ? b.key.trim() : '';
      const label = typeof b.label === 'string' ? b.label.trim() : '';
      if (!key || !label || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label });
    }
  }
  return out.length ? out : DEFAULT_BUCKETS;
}

// Whichever bucket the user named for dates — "Date Nights" today, but a
// rename to "Date Spots" or "Dates" keeps working. Matched on the label
// because the key is frozen at creation and can drift from it.
function findDateBucket(buckets) {
  return buckets.find(b => /\bdate\b/i.test(b.label)) || null;
}

// Mirrors bucketsOf: the multi-value list, else the legacy single mealType.
function bucketsOf(r, validKeys) {
  if (Array.isArray(r.buckets)) return r.buckets.filter(k => validKeys.has(k));
  if (r.mealType && validKeys.has(r.mealType)) return [r.mealType];
  return [];
}

// Mirrors restaurantMatchesBucket: in the bucket, or carrying a free-text
// category that contains the bucket's label.
function inBucket(r, bucket, validKeys) {
  if (bucketsOf(r, validKeys).includes(bucket.key)) return true;
  const term = bucket.label.toLowerCase();
  return (r.categories || []).some(c => String(c || '').toLowerCase().includes(term));
}

// No bucket named for dates at all — fall back to the category-word match so
// the card still finds something rather than silently emptying.
function categorySaysDate(r) {
  return (r?.categories || []).some(c => /\bdate\b/i.test(String(c || '')));
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
    const data = snap.exists ? (snap.data() || {}) : {};
    const restaurants = data.restaurants;
    if (!Array.isArray(restaurants)) {
      return res.status(200).json({ spots: [], reason: 'No restaurants on the Prep Day account' });
    }

    // The bucket config lives on the same doc, so this costs no extra read.
    const buckets = effectiveBuckets(data.eatingOutBuckets);
    const validKeys = new Set(buckets.map(b => b.key));
    const dateBucket = findDateBucket(buckets);
    const isDateSpot = dateBucket
      ? r => inBucket(r, dateBucket, validKeys)
      : categorySaysDate;

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

    return res.status(200).json({ spots, total: spots.length, bucket: dateBucket?.label || null });
  } catch (err) {
    if (err?.code === 'auth/user-not-found') {
      return res.status(200).json({ spots: [], reason: `No Prep Day account for ${email}` });
    }
    return res.status(500).json({ error: err?.message || 'Could not read Prep Day' });
  }
}
