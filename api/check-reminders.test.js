// The daily reminder check's "it's coming up" emails to the yeses and maybes,
// run against an in-memory Firestore with the mailer stubbed out.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sent = [];
let db;
vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), cert: vi.fn(), getApps: () => [{}] }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => db,
  FieldValue: { arrayUnion: (...values) => ({ arrayUnion: values }) },
}));
vi.mock('../lib/mailer.js', () => ({
  mailConfigured: () => true,
  sendOne: async (msg) => { sent.push(msg); return { ok: true, via: 'test' }; },
}));

const { default: handler } = await import('./check-reminders.js');

const applyPatch = (cur, patch) => {
  const out = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    const parts = k.split('.');
    let o = out;
    for (const p of parts.slice(0, -1)) { o[p] = { ...(o[p] || {}) }; o = o[p]; }
    const last = parts[parts.length - 1];
    o[last] = v?.arrayUnion ? [...new Set([...(o[last] || []), ...v.arrayUnion])] : v;
  }
  return out;
};

function fakeDb(events, options = {}) {
  const docs = new Map(Object.entries(events).map(([k, v]) => [`events/${k}`, v]));
  for (const [eventId, opts] of Object.entries(options)) {
    opts.forEach((o, i) => docs.set(`events/${eventId}/dateOptions/o${i}`, o));
  }
  const ref = (path) => ({
    id: path.split('/').pop(),
    collection: (name) => col(`${path}/${name}`),
    update: async (patch) => { docs.set(path, applyPatch(docs.get(path), patch)); },
  });
  const col = (path) => ({
    doc: (id) => ref(`${path}/${id}`),
    get: async () => ({
      docs: [...docs.entries()]
        .filter(([k]) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'))
        .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v })),
    }),
  });
  return { collection: (name) => col(name), docs };
}

const run = async () => {
  const res = { status: () => res, json: (body) => { res.body = body; return res; } };
  await handler({ method: 'GET' }, res);
  return res.body;
};

const party = () => ({
  title: 'Steak Night', location: 'NYC', stage: 'finalized',
  date: { toDate: () => new Date('2026-11-14T23:00:00Z') },
  eventReminders: { enabled: true, daysBefore: [7, 1] },
  members: {
    own: { name: 'Dan', email: 'd@x.com', role: 'owner' },
    y: { name: 'Yolanda', email: 'y@x.com' },
    m: { name: 'Mike', email: 'm@x.com' },
    n: { name: 'Nora', email: 'n@x.com' },
    r: { name: 'Rita', email: 'r@x.com', rsvp: 'maybe' },
  },
});
const votes = [{ votes: { y: { vote: 'yes' }, m: { vote: 'maybe' }, n: { vote: 'no' } } }];

describe('event reminders in the daily check', () => {
  beforeEach(() => { sent.length = 0; vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('emails the yeses and maybes a week out, once, then again the day before', async () => {
    db = fakeDb({ e1: party() }, { e1: votes });

    vi.setSystemTime(new Date('2026-11-07T14:00:05Z'));
    const first = await run();
    expect(sent.map((s) => s.to).sort()).toEqual(['m@x.com', 'r@x.com', 'y@x.com']);
    expect(sent[0].subject).toBe('Reminder: Steak Night is in 7 days (Saturday, Nov 14 · 6:00 PM)');
    expect(first.sent).toBe(3);
    expect(db.docs.get('events/e1').members.y.eventReminderLog).toEqual(['2026-11-14:7']);

    // Same day again: nothing new.
    sent.length = 0;
    await run();
    expect(sent).toHaveLength(0);

    vi.setSystemTime(new Date('2026-11-13T14:00:05Z'));
    await run();
    expect(sent).toHaveLength(3);
    expect(sent[0].subject).toContain('is tomorrow');

    sent.length = 0;
    vi.setSystemTime(new Date('2026-11-14T14:00:05Z'));
    await run();
    expect(sent).toHaveLength(0);
  });

  it('sends nothing while switched off, and leaves poll reminders to voting events', async () => {
    db = fakeDb({ e1: { ...party(), eventReminders: { enabled: false, daysBefore: [7, 1] } } }, { e1: votes });
    vi.setSystemTime(new Date('2026-11-13T14:00:05Z'));
    await run();
    expect(sent).toHaveLength(0);
  });
});
