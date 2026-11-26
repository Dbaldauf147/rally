/* global process */
// Restore points for the guest list, against an in-memory Firestore.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { planPrune, shouldSnapshot, fingerprint, HOUR, DAY } from '../lib/weddingBackups.js';

const docs = new Map();
let nextId = 0;
const docRef = (path) => ({
  id: path.split('/').pop(),
  get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
  set: async (data, opts) => {
    if (opts?.mergeFields) {
      const cur = { ...(docs.get(path) || {}) };
      for (const f of opts.mergeFields) cur[f] = data[f];
      docs.set(path, cur);
    } else docs.set(path, { ...data });
  },
  delete: async () => { docs.delete(path); },
});
const db = {
  doc: docRef,
  collection: (name) => {
    const depth = name.split('/').length + 1;
    const get = async () => ({
      docs: [...docs.entries()].filter(([k]) => k.startsWith(`${name}/`) && k.split('/').length === depth)
        .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v })),
    });
    return { get, select: () => ({ get }), doc: (id) => docRef(`${name}/${id || `auto${++nextId}`}`) };
  },
};

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), cert: vi.fn(), getApps: () => [{}] }));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: async (t) => { if (t !== 'good') throw new Error('bad'); return { uid: 'u1' }; } }),
}));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => db }));

const { default: handler, takeSnapshot } = await import('./wedding-backup.js');

const call = async (body, { token = 'good', method = 'POST', auth } = {}) => {
  const res = { status(c) { res.code = c; return res; }, json(b) { res.body = b; return res; } };
  await handler({ method, headers: { authorization: auth ?? `Bearer ${token}` }, body }, res);
  return res;
};
const guests = (n, tag = 'g') => Array.from({ length: n }, (_, i) => ({ id: `${tag}${i}`, firstName: `${tag}${i}` }));
const backups = () => [...docs.entries()].filter(([k]) => k.startsWith('weddingBackups/u1/snapshots/')).map(([k, v]) => ({ id: k.split('/').pop(), ...v }));

beforeEach(() => { docs.clear(); nextId = 0; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-26T15:00:00Z')); });
afterEach(() => { vi.useRealTimers(); delete process.env.CRON_SECRET; });

describe('restore point rules', () => {
  it('skips an empty list, a copy of the newest one, and a second one within the hour of opening', () => {
    const main = guests(3);
    const now = Date.now();
    expect(shouldSnapshot({ main: [], v2: [], reason: 'daily' })).toBe(false);
    expect(shouldSnapshot({ main, reason: 'daily' })).toBe(true);
    expect(shouldSnapshot({ main, reason: 'daily', latest: { at: now - DAY, fingerprint: fingerprint(main, []) }, now })).toBe(false);
    const stale = { at: now - 10 * 60 * 1000, fingerprint: 'other' };
    expect(shouldSnapshot({ main, reason: 'open', latest: stale, now })).toBe(false);
    expect(shouldSnapshot({ main, reason: 'before-restore', latest: stale, now })).toBe(true);
    expect(shouldSnapshot({ main, reason: 'open', latest: { ...stale, at: now - 2 * HOUR }, now })).toBe(true);
  });

  it('keeps two days whole, then one a day, then one a month', () => {
    const now = Date.parse('2026-11-26T15:00:00Z');
    const at = (iso) => Date.parse(iso);
    const list = [
      { id: 'today1', at: at('2026-11-26T09:00:00Z') },
      { id: 'today2', at: at('2026-11-26T10:00:00Z') },
      { id: 'lastweek-late', at: at('2026-11-18T20:00:00Z') },
      { id: 'lastweek-early', at: at('2026-11-18T08:00:00Z') },
      { id: 'june-late', at: at('2026-06-20T08:00:00Z') },
      { id: 'june-early', at: at('2026-06-02T08:00:00Z') },
      { id: 'may', at: at('2026-05-30T08:00:00Z') },
    ];
    expect(planPrune(list, now).sort()).toEqual(['june-early', 'lastweek-early']);
  });
});

describe('/api/wedding-backup', () => {
  it('needs a signed-in user', async () => {
    expect((await call({ action: 'list' }, { token: 'nope' })).code).toBe(401);
  });

  it('takes a restore point when the list is opened, and not another of the same list', async () => {
    docs.set('users/u1', { weddingContacts: guests(4), weddingContactsV2: guests(2, 'v'), weddingGroups: ['A'] });
    const first = await call({ action: 'snapshot' });
    expect(first.body).toMatchObject({ saved: true, backup: { mainCount: 4, v2Count: 2, reason: 'open' } });
    expect((await call({ action: 'snapshot' })).body.saved).toBe(false);
    expect(backups()).toHaveLength(1);
    expect(backups()[0].main).toEqual(guests(4));

    const listed = await call({ action: 'list' });
    expect(listed.body.backups).toEqual([{ id: first.body.backup.id, at: Date.now(), reason: 'open', mainCount: 4, v2Count: 2 }]);
  });

  it('restores a wiped list, keeps what it replaced, and leaves the rest of the document alone', async () => {
    docs.set('users/u1', { weddingContacts: guests(40), weddingContactsV2: guests(3, 'v'), weddingGroups: ['A'] });
    const { backup } = (await call({ action: 'snapshot' })).body;
    vi.setSystemTime(new Date('2026-11-26T15:20:00Z'));
    // The loss: the list replaced by a single guest.
    docs.set('users/u1', { ...docs.get('users/u1'), weddingContacts: guests(1, 'x') });

    const res = await call({ action: 'restore', id: backup.id, list: 'main' });
    expect(res.body).toEqual({ restored: 40, replaced: 1 });
    expect(docs.get('users/u1')).toEqual({ weddingContacts: guests(40), weddingContactsV2: guests(3, 'v'), weddingGroups: ['A'] });
    // The one-guest list is itself a restore point now, so the restore can be undone.
    const undo = backups().find((b) => b.reason === 'before-restore');
    expect(undo.main).toEqual(guests(1, 'x'));
  });

  it('restores the second version on its own', async () => {
    docs.set('users/u1', { weddingContacts: guests(5), weddingContactsV2: guests(3, 'v') });
    const { backup } = (await call({ action: 'snapshot' })).body;
    docs.set('users/u1', { weddingContacts: guests(6), weddingContactsV2: [] });
    await call({ action: 'restore', id: backup.id, list: 'v2' });
    expect(docs.get('users/u1')).toEqual({ weddingContacts: guests(6), weddingContactsV2: guests(3, 'v') });
  });

  it('refuses a restore that names no list, a missing restore point, or one with no guests', async () => {
    docs.set('users/u1', { weddingContacts: guests(5) });
    const { backup } = (await call({ action: 'snapshot' })).body;
    expect((await call({ action: 'restore', id: backup.id, list: 'nope' })).code).toBe(400);
    expect((await call({ action: 'restore', id: 'missing', list: 'main' })).code).toBe(404);
    expect((await call({ action: 'restore', id: backup.id, list: 'v2' })).code).toBe(400);
    expect(docs.get('users/u1').weddingContacts).toEqual(guests(5));
  });

  it('the daily run copies each account whose list changed, and nobody with no list', async () => {
    docs.set('users/u1', { weddingContacts: guests(4) });
    docs.set('users/u2', { name: 'No wedding' });
    const res = await call(undefined, { method: 'GET', auth: '' });
    expect(res.body.saved).toEqual([{ uid: 'u1', guests: 4 }]);
    expect(backups()[0].reason).toBe('daily');
    vi.setSystemTime(new Date('2026-11-27T15:00:00Z'));
    expect((await call(undefined, { method: 'GET', auth: '' })).body.saved).toEqual([]);
  });

  it('the daily run wants the cron secret when one is set', async () => {
    process.env.CRON_SECRET = 'shh';
    expect((await call(undefined, { method: 'GET', auth: 'Bearer wrong' })).code).toBe(401);
    expect((await call(undefined, { method: 'GET', auth: 'Bearer shh' })).code).toBe(200);
  });

  it('thins out old restore points as new ones are taken', async () => {
    const old = Date.parse('2026-11-10T08:00:00Z');
    docs.set('weddingBackups/u1/snapshots/a', { at: old, fingerprint: 'a', mainCount: 1 });
    docs.set('weddingBackups/u1/snapshots/b', { at: old + HOUR, fingerprint: 'b', mainCount: 2 });
    await takeSnapshot(db, 'u1', { weddingContacts: guests(3) }, 'daily');
    expect(backups().map((b) => b.id).sort()).toEqual(['auto1', 'b']);
  });
});
