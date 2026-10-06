// The daily job that opens a poll series' next round, against an in-memory
// Firestore that runs transactions for real enough to show it never opens a
// round twice.
import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), cert: vi.fn(), getApps: () => [{}] }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
  Timestamp: { fromDate: (d) => ({ toDate: () => d }) },
  FieldValue: { serverTimestamp: () => 'ts' },
}));
vi.mock('firebase-admin/auth', () => ({ getAuth: vi.fn() }));

const { openNextRound, sendRoundPoll, sendOwnerPreview } = await import('./poll-series.js');

const applyPatch = (cur, patch) => {
  const out = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    const parts = k.split('.');
    let o = out;
    for (const p of parts.slice(0, -1)) { o[p] = { ...(o[p] || {}) }; o = o[p]; }
    o[parts[parts.length - 1]] = v;
  }
  return out;
};

function fakeDb(events) {
  const docs = new Map(Object.entries(events).map(([k, v]) => [`events/${k}`, v]));
  let n = 0;
  const ref = (path) => ({
    id: path.split('/').pop(),
    path,
    collection: (name) => col(`${path}/${name}`),
    update: async (patch) => { docs.set(path, applyPatch(docs.get(path), patch)); },
  });
  const col = (path) => ({
    doc: (id) => ref(`${path}/${id || `new${++n}`}`),
    get: async () => ({
      docs: [...docs.entries()]
        .filter(([k]) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'))
        .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v })),
    }),
  });
  return {
    docs,
    collection: (name) => col(name),
    runTransaction: async (fn) => {
      const writes = [];
      const tx = {
        get: async (r) => ({ exists: docs.has(r.path), data: () => docs.get(r.path) }),
        set: (r, data) => writes.push(() => docs.set(r.path, data)),
        update: (r, patch) => writes.push(() => docs.set(r.path, applyPatch(docs.get(r.path), patch))),
      };
      const out = await fn(tx);
      writes.forEach((w) => w());
      return out;
    },
  };
}

const finalized = {
  title: 'Game night', createdBy: 'u1', stage: 'finalized', dateTBD: false,
  date: { toDate: () => new Date('2026-10-17T16:00:00Z') },
  pollSeries: { everyMonths: 1, seriesId: '', round: 1 },
  members: { u1: { role: 'owner', name: 'Dan', rsvp: 'yes' }, g1: { name: 'Sam', rsvp: 'no' } },
  memberUids: ['u1'],
};

describe('openNextRound', () => {
  it('opens round 2 with seeded dates and links both ways, once', async () => {
    const db = fakeDb({ ev1: finalized });
    db.docs.set('events/ev1/dateOptions/o1', { startDate: '2026-10-09', endDate: '2026-10-09', votes: {} });
    db.docs.set('events/ev1/dateOptions/o2', { startDate: '2026-10-17', endDate: '2026-10-17', votes: {} });
    const now = new Date('2026-10-19T12:00:00Z');

    const r = await openNextRound(db, 'ev1', now);
    expect(r).toMatchObject({ from: 'ev1', round: 2, sendDate: null, options: 8 });
    const next = db.docs.get(`events/${r.to}`);
    expect(next).toMatchObject({ stage: 'voting', dateTBD: true, previousRoundId: 'ev1', pollSeries: { everyMonths: 1, seriesId: 'ev1', round: 2 } });
    expect(next.members.g1.rsvp).toBe('pending');
    expect(next.date.toDate().toISOString().slice(0, 7)).toBe('2026-11');

    const seeded = [...db.docs.entries()].filter(([k]) => k.startsWith(`events/${r.to}/dateOptions/`)).map(([, v]) => v);
    // Fridays and Saturdays of November 2026.
    expect(seeded.map((o) => o.startDate).sort()).toEqual(['2026-11-06', '2026-11-07', '2026-11-13', '2026-11-14', '2026-11-20', '2026-11-21', '2026-11-27', '2026-11-28']);
    expect(seeded.every((o) => o.seeded && o.suggestedByName === 'Dan')).toBe(true);

    const old = db.docs.get('events/ev1');
    expect(old.nextRoundId).toBe(r.to);
    expect(old.pollSeries.seriesId).toBe('ev1');

    // A second run that day finds nothing to do.
    expect(await openNextRound(db, 'ev1', now)).toBeNull();
  });

  it('leaves a round that hasn’t happened yet', async () => {
    const db = fakeDb({ ev1: finalized });
    expect(await openNextRound(db, 'ev1', new Date('2026-10-17T20:00:00Z'))).toBeNull();
    expect(db.docs.get('events/ev1').nextRoundId).toBeUndefined();
  });
});

describe('with a send date', () => {
  const scheduled = {
    ...finalized, stage: 'voting', dateTBD: true, pollSendDate: '2026-10-20',
    members: { u1: { role: 'owner', name: 'Dan', email: 'dan@x.com', rsvp: 'yes' }, g1: { name: 'Sam', email: 'sam@x.com', rsvp: 'pending' }, g2: { name: 'Ann' } },
  };

  it('emails the guests on the send date, once', async () => {
    const db = fakeDb({ ev1: scheduled });
    const send = vi.fn(async ({ to }) => (to === 'sam@x.com' ? { ok: true } : { ok: false, error: 'refused' }));
    expect(await sendRoundPoll(db, 'ev1', new Date('2026-10-19T15:00:00Z'), { send })).toBeNull(); // not yet
    const r = await sendRoundPoll(db, 'ev1', new Date('2026-10-20T15:00:00Z'), { send });
    expect(r).toMatchObject({ sent: 1, of: 1, failed: [] });
    // The organizer isn't on it — they had the heads-up.
    expect(send.mock.calls.map(([m]) => m.to)).toEqual(['sam@x.com']);
    expect(send.mock.calls[0][0].subject).toContain('Dan is picking a date for Game night');
    const ev = db.docs.get('events/ev1');
    expect(ev.pollSentAt).toBe('2026-10-20T15:00:00.000Z');
    expect(ev.pollSendResults).toMatchObject({ sent: 1, failed: 0, of: 1 });
    expect(ev.members.g1.emailed).toBe('2026-10-20T15:00:00.000Z');
    expect(await sendRoundPoll(db, 'ev1', new Date('2026-10-21T15:00:00Z'), { send })).toBeNull(); // never twice
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('Send poll now goes ahead of the date, but not twice', async () => {
    const db = fakeDb({ ev1: scheduled });
    const send = vi.fn(async () => ({ ok: true }));
    const r = await sendRoundPoll(db, 'ev1', new Date('2026-10-06T15:00:00Z'), { force: true, send });
    expect(r.sent).toBe(1);
    expect(await sendRoundPoll(db, 'ev1', new Date('2026-10-06T16:00:00Z'), { force: true, send })).toBeNull();
  });

  it('opens the next round a week before its send date, voting or not, seeded over its window', async () => {
    const db = fakeDb({ ev1: scheduled });
    db.docs.set('events/ev1/dateOptions/o1', { startDate: '2026-10-31', endDate: '2026-10-31', votes: {} }); // a Saturday
    expect(await openNextRound(db, 'ev1', new Date('2026-11-12T15:00:00Z'))).toBeNull();
    const r = await openNextRound(db, 'ev1', new Date('2026-11-13T15:00:00Z'));
    expect(r).toMatchObject({ round: 2, sendDate: '2026-11-20' });
    const next = db.docs.get(`events/${r.to}`);
    expect(next).toMatchObject({ pollSendDate: '2026-11-20', pollWindow: { from: '2026-11-27', to: '2026-12-26' } });
    expect(next.pollSentAt).toBeUndefined();
    expect(next.date.toDate().toISOString().slice(0, 10)).toBe('2026-11-27');
    const seeded = [...db.docs.entries()].filter(([k]) => k.startsWith(`events/${r.to}/dateOptions/`)).map(([, v]) => v.startDate).sort();
    expect(seeded).toEqual(['2026-11-28', '2026-12-05', '2026-12-12', '2026-12-19', '2026-12-26']);
  });

  it('sends the organizer a heads-up a week ahead, once', async () => {
    const db = fakeDb({ ev1: scheduled });
    db.docs.set('events/ev1/dateOptions/o1', { startDate: '2026-10-31', endDate: '2026-10-31', votes: {} });
    const send = vi.fn(async () => ({ ok: true }));
    const emailOf = vi.fn(async () => 'owner@account.com');
    expect(await sendOwnerPreview(db, 'ev1', new Date('2026-10-12T15:00:00Z'), { send, emailOf })).toBeNull();
    const r = await sendOwnerPreview(db, 'ev1', new Date('2026-10-13T15:00:00Z'), { send, emailOf });
    expect(r).toMatchObject({ ok: true, to: 'owner@account.com' });
    expect(send.mock.calls[0][0].to).toBe('owner@account.com');
    expect(send.mock.calls[0][0].subject).toBe('Heads up: the Game night poll goes to 1 guest on Tue, Oct 20');
    expect(send.mock.calls[0][0].html).toContain('Sat, Oct 31');
    expect(db.docs.get('events/ev1').pollPreviewResult).toMatchObject({ ok: true, to: 'owner@account.com' });
    expect(await sendOwnerPreview(db, 'ev1', new Date('2026-10-14T15:00:00Z'), { send, emailOf })).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('records it when there’s no organizer address to send to', async () => {
    const db = fakeDb({ ev1: scheduled });
    const send = vi.fn();
    const r = await sendOwnerPreview(db, 'ev1', new Date('2026-10-13T15:00:00Z'), { send, emailOf: async () => '' });
    expect(r).toMatchObject({ ok: false });
    expect(send).not.toHaveBeenCalled();
    expect(db.docs.get('events/ev1').pollPreviewResult).toMatchObject({ ok: false });
  });
});
