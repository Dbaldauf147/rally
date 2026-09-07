/* global process */
// Pushing a Rally charge into Splitwise.
//
// One way. Rally decides the split — it knows who is a yes on the dates, who is
// somebody's +1, who came off the beer run — and Splitwise is where the people
// who live in Splitwise see what they owe. Nothing is read back.
//
// The Splitwise credential is a personal API key, so every write lands as the
// account that owns the key. That is the whole reason this is a server route
// and not a fetch from the browser: the key would be in the bundle, and anyone
// with it could post expenses to your account. It never leaves the function.
//
//   SPLITWISE_API_KEY         personal key from https://secure.splitwise.com/apps
//   FIREBASE_SERVICE_ACCOUNT  Rally's own, for verifying the caller
//
// Splitwise answers a rejected write with HTTP 200 and a populated `errors`, so
// every response is read for that rather than trusted on status alone.
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const SPLITWISE_API = 'https://secure.splitwise.com/api/v3.0';
// Splitwise flattens shares into users__N__… keys. Anything outside that shape,
// or the handful of scalars below, is not forwarded — the client composes the
// body, but this route decides what an expense is allowed to contain.
const ALLOWED_FIELDS = new Set([
  'cost', 'description', 'group_id', 'currency_code', 'date', 'details',
]);
const SHARE_KEY = /^users__\d{1,2}__(user_id|paid_share|owed_share)$/;
const MAX_SHARES = 60;

function rallyApp() {
  if (!getApps().some(a => a.name === '[DEFAULT]')) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (!sa.project_id) return null;
    initializeApp({ credential: cert(sa) });
  }
  return getApp();
}

function readErrors(payload) {
  const errors = payload?.errors;
  if (!errors) return '';
  if (Array.isArray(errors)) return errors.join(' ');
  if (typeof errors === 'string') return errors;
  const parts = [];
  for (const [field, list] of Object.entries(errors)) {
    const text = Array.isArray(list) ? list.join(', ') : String(list);
    if (text) parts.push(field === 'base' ? text : `${field}: ${text}`);
  }
  return parts.join(' · ');
}

async function splitwise(path, { key, method = 'GET', form } = {}) {
  const res = await fetch(`${SPLITWISE_API}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  // 401 means the key itself is wrong, which is worth saying plainly rather
  // than letting it surface as an empty group list.
  if (res.status === 401) throw new Error('Splitwise rejected the API key.');
  if (res.status === 429) throw new Error('Splitwise is rate-limiting us — try again shortly.');
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(readErrors(payload) || `Splitwise returned ${res.status}`);
  const problem = readErrors(payload);
  if (problem) throw new Error(problem);
  return payload;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const app = rallyApp();
  if (!app) return res.status(500).json({ error: 'Rally credentials are not configured' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    await getAuth(app).verifyIdToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const key = (process.env.SPLITWISE_API_KEY || '').trim();
  // Not an error: a deployment without the key should say so once, in the UI,
  // rather than showing a button that fails when pressed.
  if (!key) return res.status(200).json({ configured: false });

  try {
    if (req.method === 'GET') {
      // The groups you could send a trip to, with their members, so Rally can
      // line its people up against them by email without a second round trip.
      const [me, groups] = await Promise.all([
        splitwise('get_current_user', { key }),
        splitwise('get_groups', { key }),
      ]);
      return res.status(200).json({
        configured: true,
        me: me?.user ? { id: me.user.id, name: [me.user.first_name, me.user.last_name].filter(Boolean).join(' ') } : null,
        groups: (groups?.groups || [])
          // Splitwise's group 0 is "non-group expenses", which has no members
          // to split between and is never what you mean by a trip.
          .filter(g => g?.id)
          .map(g => ({
            id: g.id,
            name: g.name || 'Untitled group',
            members: (g.members || []).map(m => ({
              id: m.id,
              email: m.email || null,
              name: [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || String(m.id),
            })),
          })),
      });
    }

    const body = req.body?.expense;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'No expense to send' });
    }
    const form = {};
    let shares = 0;
    for (const [field, value] of Object.entries(body)) {
      if (ALLOWED_FIELDS.has(field)) { form[field] = String(value); continue; }
      if (SHARE_KEY.test(field)) { form[field] = String(value); shares += 1; continue; }
      return res.status(400).json({ error: `Unexpected field: ${field}` });
    }
    if (!form.cost || !form.group_id) {
      return res.status(400).json({ error: 'An expense needs a cost and a group' });
    }
    if (shares === 0) return res.status(400).json({ error: 'An expense needs shares' });
    if (shares > MAX_SHARES * 3) return res.status(400).json({ error: 'Too many people on one expense' });

    const created = await splitwise('create_expense', { key, method: 'POST', form });
    const expense = (created?.expenses || [])[0];
    if (!expense?.id) return res.status(502).json({ error: 'Splitwise did not return an expense' });
    return res.status(200).json({ configured: true, id: expense.id, description: expense.description });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Splitwise request failed' });
  }
}
