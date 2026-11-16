import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { event: null, uid: 'dan', mailOk: true, sentMail: [] };

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), cert: vi.fn(), getApps: () => [{}] }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: () => ({ doc: () => ({ get: async () => ({ exists: !!state.event, data: () => state.event }) }) }),
  }),
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: async (t) => { if (t !== 'good') throw new Error('bad'); return { uid: state.uid }; } }),
}));
vi.mock('../lib/mailer.js', () => ({
  mailConfigured: () => true,
  sendOne: async (m) => { state.sentMail.push(m); return m.to === 'bob@x.com' && !state.mailOk ? { ok: false, error: 'bounced' } : { ok: true }; },
}));

const { default: handler } = await import('./secret-santa.js');
const { decodeReveal } = await import('../src/lib/secretSantaLink.js');

function call(body, { token = 'good', method = 'POST' } = {}) {
  const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  return handler({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res).then(() => res);
}

const pairs = [
  { giver: 'dan', receiver: 'bob' },
  { giver: 'bob', receiver: 'eve' },
  { giver: 'eve', receiver: 'dan' },
];

beforeEach(() => {
  state.uid = 'dan';
  state.mailOk = true;
  state.sentMail = [];
  state.event = {
    title: 'Family Christmas',
    location: 'Home',
    createdBy: 'dan',
    members: {
      dan: { role: 'owner', name: 'Dan', email: 'dan@x.com' },
      bob: { name: 'Bob', email: 'bob@x.com' },
      eve: { name: 'Eve' },
    },
  };
});

describe('POST /api/secret-santa', () => {
  it('emails each giver their person, using addresses from the event', async () => {
    const res = await call({ eventId: 'e1', pairs, note: '$50 limit', when: 'Friday, December 25, 2026' });
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ sent: ['dan', 'bob'], failed: [], noEmail: ['eve'] });
    expect(state.sentMail.map((m) => m.to)).toEqual(['dan@x.com', 'bob@x.com']);
    // The name is not in the email — only behind the link's Reveal button.
    expect(state.sentMail[0].html).not.toContain('Bob');
    expect(state.sentMail[0].html).not.toContain('Eve');
    const picked = (html) => decodeReveal(html.match(/\/santa\?k=([\w-]+)/)[1]);
    expect(picked(state.sentMail[0].html)).toMatchObject({ giverName: 'Dan', receiverName: 'Bob', eventTitle: 'Family Christmas', note: '$50 limit', when: 'Friday, December 25, 2026', location: 'Home', fromName: 'Dan' });
    expect(picked(state.sentMail[1].html).receiverName).toBe('Eve');
    expect(state.sentMail[1].html).toContain('$50 limit');
  });

  it('names an extra exchange in the subject and on the reveal page', async () => {
    const res = await call({ eventId: 'e1', pairs, drawName: '  Sibs   Secret Santa ' });
    expect(res.code).toBe(200);
    expect(state.sentMail[0].subject).toContain('Sibs Secret Santa · Family Christmas');
    const picked = decodeReveal(state.sentMail[0].html.match(/\/santa\?k=([\w-]+)/)[1]);
    expect(picked.eventTitle).toBe('Sibs Secret Santa · Family Christmas');
    // Without a name the main exchange reads exactly as before.
    state.sentMail = [];
    await call({ eventId: 'e1', pairs });
    expect(state.sentMail[0].subject).toBe('🎅 Your Secret Santa pick for Family Christmas');
  });

  it('reports a failed send without stopping the rest', async () => {
    state.mailOk = false;
    const res = await call({ eventId: 'e1', pairs });
    expect(res.body.sent).toEqual(['dan']);
    expect(res.body.failed).toEqual([{ key: 'bob', error: 'bounced' }]);
  });

  it('sends only to the givers asked for', async () => {
    const res = await call({ eventId: 'e1', pairs, only: ['bob'] });
    expect(res.body.sent).toEqual(['bob']);
    expect(state.sentMail).toHaveLength(1);
  });

  it('is for the organizer alone', async () => {
    expect((await call({ eventId: 'e1', pairs }, { token: '' })).code).toBe(401);
    expect((await call({ eventId: 'e1', pairs }, { token: 'forged' })).code).toBe(401);
    state.uid = 'bob';
    expect((await call({ eventId: 'e1', pairs })).code).toBe(403);
    expect(state.sentMail).toHaveLength(0);
  });

  it('rejects a draw that does not fit the event, and other methods', async () => {
    expect((await call({ eventId: 'e1', pairs: [{ giver: 'dan', receiver: 'x' }, { giver: 'bob', receiver: 'dan' }] })).code).toBe(400);
    expect((await call({ pairs })).code).toBe(400);
    state.event = null;
    expect((await call({ eventId: 'gone', pairs })).code).toBe(404);
    expect((await call({}, { method: 'GET' })).code).toBe(405);
    expect(state.sentMail).toHaveLength(0);
  });
});
