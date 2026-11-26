// The Friends trash, against an in-memory Firestore.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const docs = new Map();
let nextId = 0;
const docRef = (path) => ({
  id: path.split('/').pop(),
  get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
  set: async (data) => { docs.set(path, { ...data }); },
  delete: async () => { docs.delete(path); },
});
const colRef = (name) => {
  const depth = name.split('/').length + 1;
  const get = async () => ({
    docs: [...docs.entries()].filter(([k]) => k.startsWith(`${name}/`) && k.split('/').length === depth)
      .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v })),
  });
  return { get, select: () => ({ get }), doc: (id) => docRef(`${name}/${id || `t${++nextId}`}`) };
};
const db = { doc: docRef, collection: colRef };

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), cert: vi.fn(), getApps: () => [{}] }));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: async (t) => { if (t !== 'good') throw new Error('bad'); return { uid: 'u1' }; } }),
}));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => db }));

const { default: handler } = await import('./people-trash.js');
const { purgeTrash } = await import('../lib/peopleTrash.js');

const call = async (body, token = 'good') => {
  const res = { status(c) { res.code = c; return res; }, json(b) { res.body = b; return res; } };
  await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
};
const DAY = 86400000;
const ann = { name: 'Ann', email: 'ann@x.test', familyTree: { selfPhoto: 'p-ann', people: [] }, kids: [{ name: 'Kid', photoId: 'p-kid' }] };

beforeEach(() => {
  docs.clear(); nextId = 0;
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-26T15:00:00Z'));
  docs.set('users/u1/friends/ann@x.test', ann);
  docs.set('users/u1/friends/bob', { name: 'Bob' });
  docs.set('users/u1/familyPhotos/p-ann', { data: 'x' });
  docs.set('users/u1/familyPhotos/p-kid', { data: 'y' });
});
afterEach(() => vi.useRealTimers());

describe('/api/people-trash', () => {
  it('needs a signed-in user and something to act on', async () => {
    expect((await call({ action: 'list' }, 'nope')).code).toBe(401);
    expect((await call({ action: 'trash', ids: [] })).code).toBe(400);
    expect((await call({ action: 'trash', ids: ['a/b'] })).code).toBe(400);
    expect((await call({ action: 'restore' })).code).toBe(400);
  });

  it('moves a contact to the trash whole, keeps its photos, and lists it', async () => {
    const res = await call({ action: 'trash', ids: ['ann@x.test', 'nobody'], reason: 'deleted' });
    expect(res.body.trashed).toEqual([{ itemId: 't1', friendId: 'ann@x.test', name: 'Ann' }]);
    expect(docs.has('users/u1/friends/ann@x.test')).toBe(false);
    expect(docs.get('peopleTrash/u1/items/t1')).toEqual({ friendId: 'ann@x.test', name: 'Ann', data: ann, deletedAt: Date.now(), reason: 'deleted' });
    expect(docs.has('users/u1/familyPhotos/p-ann')).toBe(true);
    expect((await call({ action: 'list' })).body.items).toEqual([{ itemId: 't1', friendId: 'ann@x.test', name: 'Ann', deletedAt: Date.now(), reason: 'deleted', daysLeft: 30 }]);
  });

  it('puts a contact back exactly as it was, under the same id', async () => {
    await call({ action: 'trash', ids: ['ann@x.test', 'bob'] });
    const res = await call({ action: 'restore', itemIds: ['t1', 't2'] });
    expect(res.body.restored.sort()).toEqual(['Ann', 'Bob']);
    expect(docs.get('users/u1/friends/ann@x.test')).toEqual(ann);
    expect((await call({ action: 'list' })).body.items).toEqual([]);
  });

  it('leaves a contact in the trash when its id is in use again', async () => {
    await call({ action: 'trash', ids: ['ann@x.test'] });
    docs.set('users/u1/friends/ann@x.test', { name: 'Ann, re-added' });
    const res = await call({ action: 'restore', itemIds: ['t1'] });
    expect(res.body).toEqual({ restored: [], skipped: ['Ann'] });
    expect(docs.get('users/u1/friends/ann@x.test')).toEqual({ name: 'Ann, re-added' });
    expect(docs.has('peopleTrash/u1/items/t1')).toBe(true);
  });

  it('empties after thirty days, taking only the photos nobody still uses', async () => {
    await call({ action: 'trash', ids: ['ann@x.test'], reason: 'merged into Bob' });
    // The merge carried Ann's own photo over to Bob.
    docs.set('users/u1/friends/bob', { name: 'Bob', familyTree: { selfPhoto: 'p-ann', people: [] } });
    vi.setSystemTime(Date.now() + 29 * DAY);
    expect(await purgeTrash(db, 'u1')).toBe(0);
    expect((await call({ action: 'list' })).body.items[0]).toMatchObject({ daysLeft: 1, reason: 'merged into Bob' });
    vi.setSystemTime(Date.now() + 2 * DAY);
    expect((await call({ action: 'list' })).body.items).toEqual([]);
    expect(docs.has('peopleTrash/u1/items/t1')).toBe(false);
    expect(docs.has('users/u1/familyPhotos/p-ann')).toBe(true);
    expect(docs.has('users/u1/familyPhotos/p-kid')).toBe(false);
  });
});
