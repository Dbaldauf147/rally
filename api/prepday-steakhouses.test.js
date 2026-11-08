import { describe, it, expect, vi, beforeEach } from 'vitest';

// Both Firebase projects faked: Rally (default app) holds the event, Prep Day
// (the 'prepday' app) holds the restaurants.
const state = vi.hoisted(() => ({ event: null, restaurants: [], tokens: {}, users: {}, updates: [], sends: [] }));

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  cert: vi.fn(),
  getApps: () => [{ name: '[DEFAULT]' }, { name: 'prepday' }],
  getApp: () => ({ name: '[DEFAULT]' }),
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TS' },
  getFirestore: (app) => (app?.name === 'prepday'
    ? {
      doc: () => ({
        get: async () => ({ exists: true, data: () => ({}) }),
        collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ restaurants: state.restaurants }) }) }) }),
      }),
    }
    : {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: !!state.event, data: () => state.event }),
          update: async (u) => { state.updates.push(u); },
        }),
      }),
    }),
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    verifyIdToken: async (t) => { if (!state.tokens[t]) throw new Error('bad'); return state.tokens[t]; },
    getUser: async (uid) => ({ email: state.users[uid] }),
    getUserByEmail: async () => ({ uid: 'prep-uid' }),
  }),
}));
vi.mock('../lib/mailer.js', () => ({
  mailConfigured: () => true,
  sendOne: async (m) => { state.sends.push(m); return { ok: !m.to.startsWith('bounce') }; },
}));

const { default: handler } = await import('./prepday-steakhouses.js');

function call({ method = 'GET', token, eventId = 'E1' }) {
  const req = { method, headers: token ? { authorization: `Bearer ${token}` } : {}, query: method === 'GET' ? { eventId } : {}, body: method === 'POST' ? { eventId } : {} };
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return handler(req, res).then(() => res);
}

beforeEach(() => {
  state.event = {
    title: 'Steak Night',
    createdBy: 'owner',
    memberUids: ['owner', 'guest'],
    members: {
      owner: { name: 'Dan Baldauf', email: 'baldaufdan@gmail.com', role: 'owner' },
      guest: { name: 'Mike', email: 'mike@x.com' },
      bounce: { name: 'Bounce', email: 'bounce@x.com' },
    },
  };
  state.restaurants = [
    { id: '1', name: 'Keens', status: 'visited', cuisines: ['Steakhouse'], guysNightDone: true, guysNightDates: ['2021-11-04'] },
    { id: '2', name: 'Benjamin', status: 'want-to-try', cuisines: ['Steakhouse'] },
  ];
  state.tokens = { T_OWNER: { uid: 'owner', email: 'baldaufdan@gmail.com' }, T_GUEST: { uid: 'guest', email: 'mike@x.com' }, T_STRANGER: { uid: 'x', email: 'x@x.com' } };
  state.users = { owner: 'baldaufdan@gmail.com', someoneElse: 'other@x.com' };
  state.updates = [];
  state.sends = [];
  vi.stubEnv('PREPDAY_FIREBASE_SERVICE_ACCOUNT', '{"project_id":"p"}');
});

describe('GET', () => {
  it('gives anyone on the event the list', async () => {
    const res = await call({ token: 'T_GUEST' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ total: 2, doneCount: 1 });
    expect(res.body.done[0]).toMatchObject({ name: 'Keens', dates: ['2021-11-04'] });
  });
  it('turns away people not on the event, and missing tokens', async () => {
    expect((await call({ token: 'T_STRANGER' })).statusCode).toBe(403);
    expect((await call({})).statusCode).toBe(401);
    expect((await call({ token: 'nope' })).statusCode).toBe(401);
  });
  it('only serves the list on events its owner organizes, with the list on', async () => {
    state.event.createdBy = 'someoneElse';
    state.event.memberUids.push('someoneElse');
    expect((await call({ token: 'T_GUEST' })).statusCode).toBe(404);
    state.event.createdBy = 'owner';
    state.event.steakhouseList = false;
    expect((await call({ token: 'T_GUEST' })).statusCode).toBe(404);
    state.event.title = 'Poker';
    delete state.event.steakhouseList;
    expect((await call({ token: 'T_GUEST' })).statusCode).toBe(404);
  });
});

describe('POST', () => {
  it('only the organizer can email it', async () => {
    const res = await call({ method: 'POST', token: 'T_GUEST' });
    expect(res.statusCode).toBe(403);
    expect(state.sends).toHaveLength(0);
  });
  it('emails everyone on the event, organizer included, and records the result', async () => {
    const res = await call({ method: 'POST', token: 'T_OWNER' });
    expect(res.statusCode).toBe(200);
    expect(state.sends.map((s) => s.to)).toEqual(['baldaufdan@gmail.com', 'mike@x.com', 'bounce@x.com']);
    expect(state.sends[1].subject).toContain('1 of 2 done');
    expect(state.sends[1].html).toContain('Hey Mike');
    expect(res.body).toMatchObject({ sent: 2, of: 3, failed: [{ to: 'bounce@x.com' }] });
    expect(state.updates[0]).toMatchObject({ steakhouseEmailResults: { sent: 2, failed: 1, of: 3 } });
    expect(typeof state.updates[0].steakhouseEmailSentAt).toBe('string');
  });
});
