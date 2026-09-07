import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The route verifies its caller with Rally's own Firebase credentials and then
// talks to Splitwise over fetch. Both are stubbed so the thing under test is
// the route's own judgement: who it lets in, what it forwards, and how it
// reads an answer Splitwise gives with a 200 whether or not it worked.
const verifyIdToken = vi.fn();
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  cert: vi.fn(),
  getApps: () => [{ name: '[DEFAULT]' }],
  getApp: () => ({}),
}));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken }) }));

const { default: handler } = await import('./splitwise.js');

function res() {
  const out = { code: 0, body: null, headers: {} };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    status(c) { out.code = c; return this; },
    json(b) { out.body = b; return this; },
  };
}
const call = (req) => { const r = res(); return handler(req, r).then(() => r.out); };
const authed = (extra = {}) => ({
  method: 'GET', headers: { authorization: 'Bearer good' }, ...extra,
});

beforeEach(() => {
  verifyIdToken.mockReset().mockResolvedValue({ uid: 'u1' });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'rally' });
  process.env.SPLITWISE_API_KEY = 'swkey';
  globalThis.fetch = vi.fn();
});
afterEach(() => { delete process.env.SPLITWISE_API_KEY; });

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

describe('who may call it', () => {
  it('turns away anything but GET and POST', async () => {
    expect((await call({ method: 'DELETE', headers: {} })).code).toBe(405);
  });

  it('turns away a caller with no token', async () => {
    expect((await call({ method: 'GET', headers: {} })).code).toBe(401);
  });

  it('turns away a token Rally does not recognise', async () => {
    verifyIdToken.mockRejectedValue(new Error('nope'));
    expect((await call(authed())).code).toBe(401);
  });

  it('never reaches Splitwise for a caller it turned away', async () => {
    await call({ method: 'GET', headers: {} });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('when no key is set on the deployment', () => {
  it('says so plainly instead of failing', async () => {
    delete process.env.SPLITWISE_API_KEY;
    const out = await call(authed());
    expect(out.code).toBe(200);
    expect(out.body).toEqual({ configured: false });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('listing groups', () => {
  beforeEach(() => {
    globalThis.fetch
      .mockResolvedValueOnce(ok({ user: { id: 1, first_name: 'Dan', last_name: 'B' } }))
      .mockResolvedValueOnce(ok({
        groups: [
          { id: 0, name: 'Non-group expenses', members: [] },
          { id: 7, name: 'Labor Day', members: [{ id: 11, first_name: 'Amy', email: 'amy@x.com' }] },
        ],
      }));
  });

  it('sends the key as a bearer token, never in the URL', async () => {
    await call(authed());
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://secure.splitwise.com/api/v3.0/get_current_user');
    expect(init.headers.Authorization).toBe('Bearer swkey');
    expect(url).not.toContain('swkey');
  });

  it('returns the groups with their members, for matching by email', async () => {
    const out = await call(authed());
    expect(out.code).toBe(200);
    expect(out.body.configured).toBe(true);
    expect(out.body.me).toEqual({ id: 1, name: 'Dan B' });
    expect(out.body.groups).toEqual([
      { id: 7, name: 'Labor Day', members: [{ id: 11, email: 'amy@x.com', name: 'Amy' }] },
    ]);
  });

  it('drops group 0, which is Splitwise’s bucket for non-group expenses', async () => {
    const out = await call(authed());
    expect(out.body.groups.map(g => g.id)).not.toContain(0);
  });
});

describe('creating an expense', () => {
  const expense = {
    cost: '45.00',
    description: 'Pizza',
    group_id: 7,
    currency_code: 'USD',
    users__0__user_id: 11,
    users__0__paid_share: '45.00',
    users__0__owed_share: '22.50',
    users__1__user_id: 22,
    users__1__paid_share: '0.00',
    users__1__owed_share: '22.50',
  };
  const post = (body) => authed({ method: 'POST', body });

  it('posts a form body and hands back the new expense id', async () => {
    globalThis.fetch.mockResolvedValue(ok({ expenses: [{ id: 999, description: 'Pizza' }], errors: {} }));
    const out = await call(post({ expense }));
    expect(out.code).toBe(200);
    expect(out.body).toMatchObject({ id: 999, configured: true });
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/create_expense');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const sent = Object.fromEntries(new URLSearchParams(init.body));
    expect(sent.cost).toBe('45.00');
    expect(sent.users__1__owed_share).toBe('22.50');
  });

  it('refuses a field it was not expecting rather than forwarding it', async () => {
    const out = await call(post({ expense: { ...expense, creation_method: 'nonsense' } }));
    expect(out.code).toBe(400);
    expect(out.body.error).toMatch(/Unexpected field: creation_method/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('refuses a share key that is not the shape Splitwise uses', async () => {
    const out = await call(post({ expense: { ...expense, users__0__evil: 'x' } }));
    expect(out.code).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('needs a cost, a group and some shares', async () => {
    expect((await call(post({ expense: { description: 'x' } }))).code).toBe(400);
    expect((await call(post({ expense: { cost: '1.00', group_id: 7 } }))).body.error).toMatch(/shares/);
    expect((await call(post({}))).body.error).toMatch(/No expense/);
  });

  // The one that matters: Splitwise says 200 for a rejected write.
  it('treats a 200 carrying errors as a failure', async () => {
    globalThis.fetch.mockResolvedValue(ok({ expenses: [], errors: { base: ['Invalid API request'] } }));
    const out = await call(post({ expense }));
    expect(out.code).toBe(502);
    expect(out.body.error).toBe('Invalid API request');
  });

  it('says plainly when the key itself is wrong', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    expect((await call(post({ expense }))).body.error).toMatch(/rejected the API key/);
  });

  it('says plainly when Splitwise is rate-limiting', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    expect((await call(post({ expense }))).body.error).toMatch(/rate-limiting/);
  });

  it('does not claim success when Splitwise returns no expense', async () => {
    globalThis.fetch.mockResolvedValue(ok({ expenses: [], errors: {} }));
    expect((await call(post({ expense }))).code).toBe(502);
  });
});
