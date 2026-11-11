// The holiday reach-out cron, against an in-memory Firestore with the mailer
// and APNs stubbed out.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mails = [];
const pushes = [];
let db;
let apnsOn = true;
vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), cert: vi.fn(), getApps: () => [{}] }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => db,
  FieldValue: { delete: () => ({ __delete: true }) },
}));
vi.mock('../lib/mailer.js', () => ({
  mailConfigured: () => true,
  sendOne: async (msg) => { mails.push(msg); return { ok: true, via: 'test' }; },
}));
vi.mock('../lib/apns.js', () => ({
  apnsConfig: () => (apnsOn ? { bundleId: 'x' } : null),
  apnsSender: () => ({
    send: async (token, payload) => { pushes.push({ token, payload }); return { ok: token !== 'dead', status: token === 'dead' ? 410 : 200, stale: token === 'dead' }; },
    close: () => {},
  }),
}));

const { default: handler } = await import('./holiday-reachout.js');

function fakeDb(seed) {
  const docs = new Map(Object.entries(seed));
  const ref = (path) => ({
    id: path.split('/').pop(),
    collection: (name) => col(`${path}/${name}`),
    update: async (patch) => {
      const out = { ...docs.get(path) };
      for (const [k, v] of Object.entries(patch)) {
        const [a, b] = k.split('.');
        if (b) { out[a] = { ...out[a] }; if (v?.__delete) delete out[a][b]; else out[a][b] = v; } else out[a] = v;
      }
      docs.set(path, out);
    },
  });
  const col = (path, filter) => ({
    doc: (id) => ref(`${path}/${id}`),
    where: (field, op, values) => col(path, (d) => (d[field] || []).some((x) => values.includes(x))),
    get: async () => ({
      docs: [...docs.entries()]
        .filter(([k]) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'))
        .filter(([, v]) => !filter || filter(v))
        .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v, ref: ref(k) })),
    }),
  });
  return { collection: (name) => col(name), docs };
}

const run = async () => {
  const res = { status: () => res, json: (body) => { res.body = body; return res; } };
  await handler({ method: 'GET' }, res);
  return res.body;
};

beforeEach(() => {
  mails.length = 0;
  pushes.length = 0;
  apnsOn = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-31T14:00:00Z')); // Halloween, 10am ET
});
afterEach(() => vi.useRealTimers());

describe('holiday reach-out cron', () => {
  it('pushes the tagged friends on the holiday, once a day', async () => {
    db = fakeDb({
      'users/u1': { email: 'me@x.com', pushTokens: { tok: true } },
      'users/u1/friends/a': { name: 'Ann', holidayTags: ['h-halloween'] },
      'users/u1/friends/b': { name: 'Bo', holidayTags: ['h-2026-christmas'] },
    });
    const body = await run();
    expect(body.today).toBe('2026-10-31');
    expect(pushes).toHaveLength(1);
    expect(pushes[0].payload.aps.alert).toEqual({ title: 'Halloween: reach out to Ann', body: 'Halloween — Ann' });
    expect(mails).toHaveLength(0);
    expect(db.docs.get('users/u1').holidayReachOutSent).toBe('2026-10-31');

    await run();
    expect(pushes).toHaveLength(1);
  });

  it('emails when no device is registered for push', async () => {
    apnsOn = false;
    db = fakeDb({
      'users/u1': { email: 'me@x.com' },
      'users/u1/friends/a': { name: 'Ann <3', holidayTags: ['h-halloween'] },
    });
    await run();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe('me@x.com');
    expect(mails[0].html).toContain('Ann &lt;3');
  });

  it('reads custom holidays from the mirrored list', async () => {
    db = fakeDb({
      'users/u1': { pushTokens: { tok: true }, holidayList: [{ id: 'h-x', name: 'Mom’s name day', rule: { kind: 'date', months: [10], day: 31 } }] },
      'users/u1/friends/a': { name: 'Mom', holidayTags: ['h-x'] },
      'users/u1/friends/b': { name: 'Ann', holidayTags: ['h-halloween'] },
    });
    await run();
    expect(pushes.map((p) => p.payload.aps.alert.title)).toEqual(['Mom’s name day: reach out to Mom']);
  });

  it('stays quiet on a day nobody is tagged for, and drops dead tokens', async () => {
    db = fakeDb({
      'users/u1': { pushTokens: { tok: true } },
      'users/u1/friends/a': { name: 'Ann', holidayTags: ['h-2026-christmas'] },
      'users/u2': { pushTokens: { dead: true, tok: true } },
      'users/u2/friends/a': { name: 'Cy', holidayTags: ['h-halloween'] },
    });
    await run();
    expect(pushes.map((p) => p.token)).toEqual(['dead', 'tok']);
    expect(db.docs.get('users/u2').pushTokens).toEqual({ tok: true });
    expect(db.docs.get('users/u1').holidayReachOutSent).toBeUndefined();
  });
});
