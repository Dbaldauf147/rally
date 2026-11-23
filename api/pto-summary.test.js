// The PTO summary route, against an in-memory Firestore with the mailer
// stubbed out.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mails = [];
let db;
vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), cert: vi.fn(), getApps: () => [{}] }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => db }));
vi.mock('../lib/mailer.js', () => ({
  mailConfigured: () => true,
  sendOne: async (msg) => { mails.push(msg); return msg.to.includes('bounce') ? { ok: false, error: 'refused' } : { ok: true }; },
}));

const { default: handler } = await import('./pto-summary.js');

function fakeDb(seed) {
  const docs = new Map(Object.entries(seed));
  const ref = (path) => ({
    id: path.split('/').pop(),
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    set: async (patch) => {
      const cur = { ...(docs.get(path) || {}) };
      for (const [k, v] of Object.entries(patch)) cur[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(cur[k] || {}), ...v } : v;
      docs.set(path, cur);
    },
  });
  return {
    docs,
    collection: (name) => ({
      doc: (id) => ref(`${name}/${id}`),
      get: async () => ({
        docs: [...docs.entries()].filter(([k]) => k.startsWith(`${name}/`))
          .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v })),
      }),
    }),
  };
}

const call = async (req) => {
  const res = { status: (c) => { res.code = c; return res; }, json: (body) => { res.body = body; return res; } };
  await handler(req, res);
  return res;
};

const pto = {
  years: [{ year: 2026, total: 27, eoyBackup: 5, start: '2026-01-01', end: '2026-12-31' }],
  entries: [
    { id: 'a', label: 'Spring break', start: '2026-03-02', end: '2026-03-02', days: 1 },
    { id: 'b', label: 'Thanksgiving', start: '2026-11-25', end: '2026-11-27', days: 3 },
  ],
};

beforeEach(() => { mails.length = 0; vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe('PTO summary cron', () => {
  it('sends the owner theirs on Nov 1 at 8 AM Eastern, once', async () => {
    db = fakeDb({ 'users/me': { email: 'baldaufdan@gmail.com', pto }, 'users/other': { email: 'x@y.com', pto } });
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z')); // 7 AM EST — not yet
    expect((await call({ method: 'GET' })).body.sent).toBe(0);

    vi.setSystemTime(new Date('2026-11-01T13:00:00Z'));
    const res = await call({ method: 'GET' });
    expect(res.body.sent).toBe(1);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe('daniel.baldauf@se.com');
    expect(mails[0].subject).toBe('2026 PTO: 23 days left, 3 scheduled, 1 taken');
    expect(db.docs.get('users/me').ptoSummary.lastSentYear).toBe(2026);

    await call({ method: 'GET' });
    expect(mails).toHaveLength(1);
  });

  it('goes to the addresses saved on the page, and records a refusal', async () => {
    db = fakeDb({ 'users/me': { email: 'baldaufdan@gmail.com', pto, ptoSummary: { enabled: true, emails: ['new@work.com', 'bounce@x.com'] } } });
    vi.setSystemTime(new Date('2026-11-01T13:00:00Z'));
    await call({ method: 'GET' });
    expect(mails.map((m) => m.to)).toEqual(['new@work.com', 'bounce@x.com']);
    expect(db.docs.get('users/me').ptoSummary.lastResult.failed).toEqual([{ email: 'bounce@x.com', error: 'refused' }]);
  });

  it('sends nothing when turned off', async () => {
    db = fakeDb({ 'users/me': { email: 'baldaufdan@gmail.com', pto, ptoSummary: { enabled: false } } });
    vi.setSystemTime(new Date('2026-11-01T13:00:00Z'));
    await call({ method: 'GET' });
    expect(mails).toHaveLength(0);
  });
});

describe('preview and send now', () => {
  beforeEach(() => { vi.setSystemTime(new Date('2026-11-23T15:00:00Z')); });

  it('previews without sending', async () => {
    db = fakeDb({ 'users/me': { email: 'baldaufdan@gmail.com', pto } });
    const res = await call({ method: 'POST', body: { uid: 'me', preview: true } });
    expect(res.body.subject).toBe('2026 PTO: 23 days left, 3 scheduled, 1 taken');
    expect(res.body.html).toMatch(/Thanksgiving/);
    expect(mails).toHaveLength(0);
  });

  it('send now goes to the saved addresses and does not mark the year sent', async () => {
    db = fakeDb({ 'users/me': { email: 'baldaufdan@gmail.com', pto } });
    const res = await call({ method: 'POST', body: { uid: 'me', to: 'attacker@evil.com' } });
    expect(res.body.sentTo).toEqual(['daniel.baldauf@se.com']);
    expect(mails.map((m) => m.to)).toEqual(['daniel.baldauf@se.com']);
    expect(db.docs.get('users/me').ptoSummary).toBeUndefined();
  });

  it('says why when there is no PTO saved', async () => {
    db = fakeDb({ 'users/me': { email: 'baldaufdan@gmail.com' } });
    const res = await call({ method: 'POST', body: { uid: 'me' } });
    expect(res.body.skipped).toBe('no PTO saved yet');
  });
});
