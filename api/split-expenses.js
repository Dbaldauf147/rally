// Receives charges from Wealth Architect that need splitting between people.
//
// The two apps live in different Firebase projects — Rally in rally-bd41a,
// Wealth Architect in its own — so neither can read the other's database.
// This endpoint is the whole contract between them: Wealth Architect's server
// posts a charge with a shared secret, and it lands in Rally's `expenses`
// collection as something you can assign to an event and split up.
//
// It authenticates with a secret rather than a user token because the caller
// is a server, not a signed-in person. The secret only ever lives in the two
// deployments' env vars.
//
//   RALLY_INGEST_SECRET       must match Wealth Architect's copy
//   FIREBASE_SERVICE_ACCOUNT  Rally's own, already used by the other endpoints
//   RALLY_OWNER_EMAIL         whose expenses these are (defaults below)
/* global process */
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const DEFAULT_OWNER_EMAIL = 'baldaufdan@gmail.com';

function rallyApp() {
  if (!getApps().some(a => a.name === '[DEFAULT]')) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (!sa.project_id) return null;
    initializeApp({ credential: cert(sa) });
  }
  return getApp();
}

// Compare secrets in constant time so a wrong guess can't be narrowed down by
// how long the answer took.
function secretMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const str = (v, max = 300) => String(v == null ? '' : v).slice(0, max);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expected = process.env.RALLY_INGEST_SECRET;
  if (!expected) {
    return res.status(503).json({ error: 'Expense ingest is not configured' });
  }
  if (!secretMatches(req.headers['x-rally-ingest-secret'], expected)) {
    return res.status(401).json({ error: 'Bad ingest secret' });
  }

  // Validate the request before reaching for credentials: a malformed body is
  // the caller's problem (400) whether or not this deployment is wired up, and
  // answering 500 for it would send someone checking env vars over a typo.
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const externalId = str(body.externalId, 200);
  const amount = Number(body.amount);
  if (!externalId) return res.status(400).json({ error: 'externalId is required' });
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  const app = rallyApp();
  if (!app) return res.status(500).json({ error: 'Rally credentials are not configured' });

  const db = getFirestore(app);

  // Who these expenses belong to, and the member key they will be the payer
  // under. Falling back to the email key matches how Rally keys a member who
  // was added before they had an account (see src/lib/members.js).
  const ownerEmail = (process.env.RALLY_OWNER_EMAIL || DEFAULT_OWNER_EMAIL).trim();
  let ownerUid = null;
  try {
    ownerUid = (await getAuth(app).getUserByEmail(ownerEmail)).uid;
  } catch {
    ownerUid = null;
  }
  const payer = ownerUid || ownerEmail.replace(/[.@#$/[\]]/g, '_').toLowerCase();

  const now = new Date().toISOString();
  const fields = {
    source: str(body.source, 60) || 'wealth-architect',
    externalId,
    description: str(body.description) || 'Untitled charge',
    fullDescription: str(body.fullDescription, 500),
    amount,
    date: str(body.date, 40),
    account: str(body.account, 120),
    category: str(body.category, 120),
    subcategory: str(body.subcategory, 120),
    note: str(body.note, 500),
    ownerUid: ownerUid || null,
    ownerEmail,
    updatedAt: now,
  };

  try {
    // Idempotent on the originating transaction id: re-tagging the same
    // charge, or a retry after a timeout that actually succeeded, updates the
    // one expense rather than creating a duplicate someone has to spot and
    // delete. The split itself — event, shares, who has settled — is only set
    // on create, so a re-send never wipes work already done in Rally.
    const existing = await db.collection('expenses')
      .where('externalId', '==', externalId)
      .limit(1)
      .get();

    if (!existing.empty) {
      const ref = existing.docs[0].ref;
      await ref.update(fields);
      return res.status(200).json({ id: ref.id, updated: true });
    }

    const ref = await db.collection('expenses').add({
      ...fields,
      eventId: null,
      paidBy: payer,
      splitMode: 'even',
      shares: {},
      participants: [payer],
      settled: {},
      archived: false,
      createdAt: now,
    });
    return res.status(200).json({ id: ref.id, updated: false });
  } catch (err) {
    return res.status(500).json({ error: `Could not save the expense: ${err.message}` });
  }
}
