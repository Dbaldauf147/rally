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

// Somewhere new to go beats somewhere we've been, so unvisited spots sort
// first — but visited ones still fill the remaining slots. Filtering them out
// entirely left the card with a single row, most date spots being places we
// already like.
function unvisitedFirst(r) {
  return r?.status === 'want-to-try' ? 0 : 1;
}

// Punctuation and spacing differ between a hand-typed entry and a Maps import
// of the same place, so compare on letters and digits only.
function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Just the street line. A Maps import carries the full "25 Clinton St, New
// York, NY 10002, USA" where the hand-typed twin stops at the zip, so matching
// whole addresses misses the pair — but the street number is still specific
// enough to keep two branches of the same chain apart.
function streetOf(address) {
  return normalize(String(address || '').split(',')[0]);
}

// The same place can sit in the list twice under different ids (imported once
// by hand and once from a Maps link, say). Five slots are too few to spend two
// on one restaurant, so collapse by name+address. Runs after the sort, so the
// copy that survives is the better-ranked one.
function dedupe(list) {
  const seen = new Set();
  return list.filter(r => {
    const key = `${normalize(r.name)}|${streetOf(r.address)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Prep Day keeps the list at users/{uid}/data/eatingOut.restaurants. The field
 * of the same name on the user doc is the legacy home, and Prep Day DELETES it
 * once a client migrates the account (see its firestoreSync saveRestaurants),
 * so the subdoc is read first and the old field only as a fallback.
 */
function pickRestaurants(eatingOutSnap, userData) {
  const fromSubdoc = eatingOutSnap.exists ? eatingOutSnap.data()?.restaurants : null;
  if (Array.isArray(fromSubdoc)) return fromSubdoc;
  return Array.isArray(userData.restaurants) ? userData.restaurants : null;
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
    // The bucket config lives on the user doc, the restaurants in a subdoc.
    const userRef = getFirestore(prepday).doc(`users/${prepUser.uid}`);
    const [userSnap, eatingOutSnap] = await Promise.all([
      userRef.get(),
      userRef.collection('data').doc('eatingOut').get(),
    ]);
    const data = userSnap.exists ? (userSnap.data() || {}) : {};
    const restaurants = pickRestaurants(eatingOutSnap, data);
    if (!restaurants) {
      return res.status(200).json({ spots: [], reason: 'No restaurants on the Prep Day account' });
    }

    const buckets = effectiveBuckets(data.eatingOutBuckets);
    const validKeys = new Set(buckets.map(b => b.key));
    const dateBucket = findDateBucket(buckets);
    const isDateSpot = dateBucket
      ? r => inBucket(r, dateBucket, validKeys)
      : categorySaysDate;

    const matching = dedupe(
      restaurants
        .filter(r => r && isDateSpot(r))
        .sort((a, b) => unvisitedFirst(a) - unvisitedFirst(b) || byPriority(a, b)),
    );
    const spots = matching
      .slice(0, limit)
      // Only what the Plans card renders — no notes, ratings, or coordinates.
      .map(r => ({
        id: r.id,
        name: r.name || '',
        url: r.url || '',
        address: r.address || '',
        dish: r.dish || '',
        categories: r.categories || [],
        // Lets the card mark the ones we've already been to.
        visited: r.status !== 'want-to-try',
        // Prep Day's own "Taken Joanne here" checkbox. Only ever written as
        // true, so absent means no — which is the answer the card wants.
        takenJoanne: r.takenJoanne === true,
      }));

    return res.status(200).json({
      spots,
      total: matching.length,
      bucket: dateBucket?.label || null,
    });
  } catch (err) {
    if (err?.code === 'auth/user-not-found') {
      return res.status(200).json({ spots: [], reason: `No Prep Day account for ${email}` });
    }
    return res.status(500).json({ error: err?.message || 'Could not read Prep Day' });
  }
}
