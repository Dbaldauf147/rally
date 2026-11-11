/* global process */
// The Venues tab's Gmail endpoint and the callback half, against an in-memory
// Firestore, with Google and the inbox scan stubbed out.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const docs = new Map();
const DELETE = { __delete: true };
const STAMP = { __stamp: true };
const mergeInto = (cur = {}, patch) => {
  const out = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (v === DELETE) delete out[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && v !== STAMP) out[k] = mergeInto(out[k], v);
    else out[k] = v === STAMP ? { toDate: () => new Date('2026-11-01T00:00:00Z'), toMillis: () => Date.now() } : v;
  }
  return out;
};
const db = {
  collection: (name) => ({
    get: async () => ({
      docs: [...docs.entries()].filter(([k]) => k.startsWith(`${name}/`) && k.split('/').length === 2)
        .map(([k, v]) => ({ id: k.split('/')[1], data: () => v })),
    }),
  }),
  doc: (path) => ({
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    set: async (data, opts) => {
      if (opts?.merge) docs.set(path, mergeInto(docs.get(path), data));
      else if (opts?.mergeFields) {
        const cur = { ...(docs.get(path) || {}) };
        for (const f of opts.mergeFields) cur[f] = mergeInto({}, { [f]: data[f] })[f];
        docs.set(path, cur);
      } else docs.set(path, mergeInto({}, data));
    },
    delete: async () => { docs.delete(path); },
  }),
};

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), cert: vi.fn(), getApps: () => [{}] }));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: async (t) => { if (t !== 'good') throw new Error('bad'); return { uid: 'u1' }; } }),
}));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => db, FieldValue: { delete: () => DELETE, serverTimestamp: () => STAMP } }));
const scanInbox = vi.fn();
let refreshResult = async () => 'access-1';
vi.mock('../lib/weddingVenueScan.js', () => ({
  scanInbox: (...a) => scanInbox(...a),
  refreshAccessToken: (...a) => refreshResult(...a),
}));

const { default: handler, isAutoScanDue } = await import('./wedding-venues.js');
const { finishGmailConnect } = await import('../lib/weddingGmailAuth.js');

const call = async (body, token = 'good') => {
  const res = { status(c) { res.code = c; return res; }, json(b) { res.body = b; return res; } };
  await handler({ method: 'POST', headers: { authorization: `Bearer ${token}`, host: 'rally.test', 'x-forwarded-proto': 'https' }, body }, res);
  return res;
};

beforeEach(() => {
  docs.clear();
  scanInbox.mockReset();
  refreshResult = async () => 'access-1';
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('api/wedding-venues', () => {
  it('needs a signed-in user', async () => {
    expect((await call({ action: 'scan' }, 'nope')).code).toBe(401);
  });

  it('connect hands back a Google URL for read-only Gmail on the existing callback', async () => {
    const res = await call({ action: 'connect', loginHint: 'jodanbaldauf@gmail.com' });
    expect(res.code).toBe(200);
    const url = new URL(res.body.url);
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
    expect(url.searchParams.get('redirect_uri')).toBe('https://rally.test/api/google-callback');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('login_hint')).toBe('jodanbaldauf@gmail.com');
    const nonce = url.searchParams.get('state').replace(/^gmail\./, '');
    expect(docs.get(`weddingGmailOAuth/${nonce}`).uid).toBe('u1');
  });

  it('scan without a linked inbox says so', async () => {
    const res = await call({ action: 'scan' });
    expect(res.code).toBe(409);
    expect(res.body.code).toBe('not_connected');
  });

  it('scan reads since the last scan and stamps it', async () => {
    docs.set('weddingGmailTokens/u1', { refreshToken: 'r1', email: 'jo@gmail.com' });
    docs.set('users/u1', { weddingGmail: { email: 'jo@gmail.com', lastScanAt: { toDate: () => new Date('2026-10-01T00:00:00Z') } } });
    scanInbox.mockResolvedValue({ venues: [{ name: 'The Foundry' }], threadCount: 4 });
    const res = await call({ action: 'scan' });
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ venues: [{ name: 'The Foundry' }], threadCount: 4, account: 'jo@gmail.com' });
    expect(scanInbox).toHaveBeenCalledWith('access-1', { since: new Date('2026-10-01T00:00:00Z') });
    expect(docs.get('users/u1').weddingGmail.email).toBe('jo@gmail.com');
    expect(docs.get('users/u1').weddingGmail.lastScanAt.toDate()).toEqual(new Date('2026-11-01T00:00:00Z'));
  });

  it('a full rescan ignores the last scan date', async () => {
    docs.set('weddingGmailTokens/u1', { refreshToken: 'r1', email: 'jo@gmail.com' });
    docs.set('users/u1', { weddingGmail: { email: 'jo@gmail.com', lastScanAt: { toDate: () => new Date('2026-10-01') } } });
    scanInbox.mockResolvedValue({ venues: [], threadCount: 0 });
    await call({ action: 'scan', full: true });
    expect(scanInbox).toHaveBeenCalledWith('access-1', { since: null });
  });

  it('an expired or revoked connection is forgotten', async () => {
    docs.set('weddingGmailTokens/u1', { refreshToken: 'r1', email: 'jo@gmail.com' });
    docs.set('users/u1', { weddingGmail: { email: 'jo@gmail.com' }, weddingVenues: [{ name: 'Keep me' }] });
    refreshResult = async () => { const e = new Error('Token has been expired or revoked.'); e.code = 'invalid_grant'; throw e; };
    const res = await call({ action: 'scan' });
    expect(res.code).toBe(409);
    expect(docs.has('weddingGmailTokens/u1')).toBe(false);
    expect(docs.get('users/u1').weddingGmail).toBeUndefined();
    expect(docs.get('users/u1').weddingVenues).toEqual([{ name: 'Keep me' }]);
  });

  it('disconnect revokes and forgets', async () => {
    docs.set('weddingGmailTokens/u1', { refreshToken: 'r1' });
    docs.set('users/u1', { weddingGmail: { email: 'jo@gmail.com' } });
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await call({ action: 'disconnect' })).code).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toContain('oauth2.googleapis.com/revoke?token=r1');
    expect(docs.has('weddingGmailTokens/u1')).toBe(false);
    expect(docs.get('users/u1').weddingGmail).toBeUndefined();
  });
});

describe('finishGmailConnect', () => {
  const google = (overrides = {}) => vi.fn(async (url) => ({
    json: async () => (String(url).includes('/token')
      ? { access_token: 'a', refresh_token: 'r-new', scope: 'https://www.googleapis.com/auth/gmail.readonly', ...overrides }
      : { emailAddress: 'jodanbaldauf@gmail.com' }),
  }));

  it('stores the refresh token server-side and only the address on the user doc', async () => {
    docs.set('weddingGmailOAuth/n1', { uid: 'u1', createdAt: { toMillis: () => Date.now() } });
    docs.set('users/u1', { weddingGmail: { email: 'old@gmail.com', lastScanAt: 'x' }, other: 1 });
    vi.stubGlobal('fetch', google());
    const out = await finishGmailConnect({ nonce: 'n1', code: 'c', redirectUri: 'https://rally.test/api/google-callback' });
    expect(out).toEqual({ email: 'jodanbaldauf@gmail.com' });
    expect(docs.get('weddingGmailTokens/u1')).toMatchObject({ refreshToken: 'r-new', email: 'jodanbaldauf@gmail.com' });
    const user = docs.get('users/u1');
    expect(user.other).toBe(1);
    expect(user.weddingGmail.email).toBe('jodanbaldauf@gmail.com');
    expect(user.weddingGmail.lastScanAt).toBeUndefined();
    expect(JSON.stringify(user)).not.toContain('r-new');
    expect(docs.has('weddingGmailOAuth/n1')).toBe(false);
  });

  it('refuses an unknown or stale sign-in', async () => {
    vi.stubGlobal('fetch', google());
    await expect(finishGmailConnect({ nonce: 'nope', code: 'c', redirectUri: 'x' })).rejects.toThrow(/expired/);
    docs.set('weddingGmailOAuth/old', { uid: 'u1', createdAt: { toMillis: () => Date.now() - 60 * 60 * 1000 } });
    await expect(finishGmailConnect({ nonce: 'old', code: 'c', redirectUri: 'x' })).rejects.toThrow(/expired/);
  });

  it('refuses when Gmail access was not granted', async () => {
    docs.set('weddingGmailOAuth/n2', { uid: 'u1', createdAt: { toMillis: () => Date.now() } });
    vi.stubGlobal('fetch', google({ scope: 'openid' }));
    await expect(finishGmailConnect({ nonce: 'n2', code: 'c', redirectUri: 'x' })).rejects.toThrow(/Gmail read access/);
  });
});

describe('api/google-callback with a gmail. state', () => {
  const run = async (query) => {
    const { default: callback } = await import('./google-callback.js');
    const res = { headers: {}, status(c) { res.code = c; return res; }, setHeader(k, v) { res.headers[k] = v; return res; }, send(b) { res.body = b; return res; } };
    await callback({ query, headers: { host: 'rally.test', 'x-forwarded-proto': 'https' } }, res);
    return res;
  };

  it('links the inbox and tells the opener which one', async () => {
    docs.set('weddingGmailOAuth/n9', { uid: 'u1', createdAt: { toMillis: () => Date.now() } });
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      json: async () => (String(url).includes('/token')
        ? { access_token: 'a', refresh_token: 'r9', scope: 'https://www.googleapis.com/auth/gmail.readonly' }
        : { emailAddress: 'jodanbaldauf@gmail.com' }),
    })));
    const res = await run({ code: 'c', state: 'gmail.n9' });
    expect(res.body).toContain('"type":"gmail-connected"');
    expect(res.body).toContain('jodanbaldauf@gmail.com');
    expect(res.body).not.toContain('r9');
    expect(docs.get('weddingGmailTokens/u1').refreshToken).toBe('r9');
  });

  it('reports a failure without letting the message break out of the script', async () => {
    const res = await run({ error: '</script><img src=x>', state: 'gmail.zz' });
    expect(res.body).toContain('"type":"gmail-error"');
    expect(res.body).not.toContain('</script><img');
  });
});

describe('daily scheduled scan', () => {
  const get = async (now, headers = {}) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const res = { status(c) { res.code = c; return res; }, json(b) { res.body = b; return res; } };
      await handler({ method: 'GET', headers, body: {} }, res);
      return res;
    } finally {
      vi.useRealTimers();
    }
  };
  afterEach(() => { delete process.env.CRON_SECRET; });

  it('is due from 9 AM Eastern, once a day, unless switched off', () => {
    const g = { email: 'a@b.com' };
    expect(isAutoScanDue(g, new Date('2026-11-11T13:30:00Z'))).toBe(false); // 8:30 EST
    expect(isAutoScanDue(g, new Date('2026-11-11T14:05:00Z'))).toBe(true); // 9:05 EST
    expect(isAutoScanDue(g, new Date('2026-07-11T13:05:00Z'))).toBe(true); // 9:05 EDT
    expect(isAutoScanDue({ ...g, lastAutoScanDate: '2026-11-11' }, new Date('2026-11-11T14:05:00Z'))).toBe(false);
    expect(isAutoScanDue({ ...g, autoScan: false }, new Date('2026-11-11T14:05:00Z'))).toBe(false);
    expect(isAutoScanDue(null, new Date('2026-11-11T14:05:00Z'))).toBe(false);
  });

  it('scans each linked inbox and folds the venues into the saved list', async () => {
    docs.set('weddingGmailTokens/u1', { refreshToken: 'r1', email: 'a@b.com' });
    docs.set('users/u1', {
      weddingGmail: { email: 'a@b.com' },
      weddingVenues: [{ id: 'v1', name: 'The Foundry', perPlate: '$150', status: 'Inquired' }],
      weddingVenueDismissed: ['old barn'],
    });
    docs.set('users/u2', { name: 'not linked' });
    scanInbox.mockResolvedValue({
      threadCount: 3,
      venues: [
        { name: 'Foundry', venueFee: '$18,000', perPlate: '$185/pp', allInclusive: 'No', status: 'Quote received', threadIds: ['t1'] },
        { name: 'Pridwin', perPlate: '$210/pp', allInclusive: 'Yes', status: 'Replied', threadIds: ['t2'] },
        { name: 'Old Barn', status: 'Replied', threadIds: ['t3'] },
      ],
    });
    const res = await get(new Date('2026-11-11T14:05:00Z'));
    expect(res.code).toBe(200);
    expect(res.body.scanned).toBe(1);
    const u = docs.get('users/u1');
    expect(u.weddingVenues.map((v) => v.name)).toEqual(['The Foundry', 'Pridwin']);
    expect(u.weddingVenues[0]).toMatchObject({ venueFee: '$18,000', perPlate: '$150', allInclusive: 'No', status: 'Quote received' });
    expect(u.weddingVenues[1]).toMatchObject({ allInclusive: 'Yes', source: 'gmail' });
    expect(u.weddingGmail).toMatchObject({ lastAutoScanDate: '2026-11-11', lastAutoScan: { added: ['Pridwin'], updatedCount: 1 } });
    expect(u.weddingGmail.lastScanAt).toBeTruthy();

    // The second cron run the same day finds it done.
    scanInbox.mockClear();
    const again = await get(new Date('2026-11-11T15:00:00Z'));
    expect(again.body.scanned).toBe(0);
    expect(scanInbox).not.toHaveBeenCalled();
  });

  it('notes a failure on the user doc rather than throwing', async () => {
    docs.set('users/u1', { weddingGmail: { email: 'a@b.com' } });
    const res = await get(new Date('2026-11-11T14:05:00Z'));
    expect(res.code).toBe(200);
    expect(docs.get('users/u1').weddingGmail.lastAutoScan.error).toMatch(/Connect a Gmail inbox/);
  });

  it('wants the cron secret when one is set', async () => {
    process.env.CRON_SECRET = 'shh';
    expect((await get(new Date('2026-11-11T14:05:00Z'))).code).toBe(401);
    expect((await get(new Date('2026-11-11T14:05:00Z'), { authorization: 'Bearer shh' })).code).toBe(200);
  });
});
