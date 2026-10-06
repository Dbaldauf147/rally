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

const { openNextRound } = await import('./poll-series.js');

function fakeDb(events) {
  const docs = new Map(Object.entries(events).map(([k, v]) => [`events/${k}`, v]));
  let n = 0;
  const ref = (path) => ({
    id: path.split('/').pop(),
    path,
    collection: (name) => col(`${path}/${name}`),
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
        update: (r, patch) => writes.push(() => {
          const cur = { ...docs.get(r.path) };
          for (const [k, v] of Object.entries(patch)) {
            if (k.includes('.')) { const [a, b] = k.split('.'); cur[a] = { ...cur[a], [b]: v }; } else cur[k] = v;
          }
          docs.set(r.path, cur);
        }),
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
    expect(r).toMatchObject({ from: 'ev1', round: 2, month: '2026-11' });
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
