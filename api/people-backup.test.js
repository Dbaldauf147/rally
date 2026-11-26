/* global process */
// The daily people backup file, against an in-memory Firestore and a stub mailer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildPeopleFile, fileFingerprint, toChunks, fromChunks, dropWarnings, changesSince, missingFriends, CHUNK_BYTES } from '../lib/peopleBackup.js';

const docs = new Map();
let nextId = 0;
const docRef = (path) => ({
  id: path.split('/').pop(),
  get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
  set: async (data, opts) => { docs.set(path, opts?.merge ? { ...(docs.get(path) || {}), ...data } : { ...data }); },
  delete: async () => { docs.delete(path); },
  collection: (name) => colRef(`${path}/${name}`),
});
const colRef = (name) => {
  const depth = name.split('/').length + 1;
  const get = async () => ({
    docs: [...docs.entries()].filter(([k]) => k.startsWith(`${name}/`) && k.split('/').length === depth)
      .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v })),
  });
  return { get, select: () => ({ get }), doc: (id) => docRef(`${name}/${id || `auto${++nextId}`}`) };
};
const db = { doc: docRef, collection: colRef };

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), cert: vi.fn(), getApps: () => [{}] }));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: async (t) => { if (t !== 'good') throw new Error('bad'); return { uid: 'u1' }; } }),
}));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => db }));
const sent = [];
let mailOk = true;
vi.mock('../lib/mailer.js', () => ({
  mailConfigured: () => true,
  sendOne: async (m) => { sent.push(m); return mailOk ? { ok: true, via: 'gmail' } : { ok: false, error: 'refused' }; },
}));

const { default: handler } = await import('./people-backup.js');

const call = async (body, { token = 'good', method = 'POST', auth } = {}) => {
  const res = { status(c) { res.code = c; return res; }, json(b) { res.body = b; return res; } };
  await handler({ method, headers: { authorization: auth ?? `Bearer ${token}` }, body }, res);
  return res;
};
const cron = () => call(undefined, { method: 'GET', auth: '' });
const friends = (n, uid = 'u1') => { for (let i = 0; i < n; i += 1) docs.set(`users/${uid}/friends/f${i}`, { name: `Friend ${i}`, email: `f${i}@x.test`, familyTree: { parents: ['A'] } }); };
const guests = (n) => Array.from({ length: n }, (_, i) => ({ id: `g${i}`, firstName: `G${i}` }));
const days = (uid = 'u1') => [...docs.entries()].filter(([k]) => k.startsWith(`peopleBackups/${uid}/days/`) && k.split('/').length === 4).map(([k, v]) => ({ id: k.split('/').pop(), ...v }));
const owner = { email: 'baldaufdan@gmail.com' };

beforeEach(() => { docs.clear(); sent.length = 0; nextId = 0; mailOk = true; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-26T09:40:00Z')); });
afterEach(() => { vi.useRealTimers(); delete process.env.CRON_SECRET; });

describe('the people file', () => {
  it('holds every contact whole and the people lists, and nothing else from the user document', () => {
    const file = buildPeopleFile({
      userData: { weddingContacts: guests(2), reachOuts: [{ id: 'r' }], doctors: [{ name: 'private' }], weddingGmail: { x: 1 } },
      friends: [{ id: 'b', name: 'B', kids: [{ name: 'K' }] }, { id: 'a', name: 'A', when: { toDate: () => new Date('2026-01-02T00:00:00Z') } }],
      now: Date.parse('2026-11-26T09:40:00Z'),
    });
    expect(file.counts).toEqual({ friends: 2, guests: 2, guestsV2: 0, reachOuts: 1 });
    expect(file.friends.map((f) => f.id)).toEqual(['a', 'b']);
    expect(file.friends[0].when).toBe('2026-01-02T00:00:00.000Z');
    expect(file.friends[1].kids).toEqual([{ name: 'K' }]);
    expect(Object.keys(file.user).sort()).toEqual(['reachOuts', 'weddingContacts']);
  });

  it('has the same fingerprint whatever order the fields or contacts come in', () => {
    const a = buildPeopleFile({ friends: [{ id: '1', name: 'A', email: 'a' }, { id: '2', name: 'B' }], now: 1 });
    const b = buildPeopleFile({ friends: [{ id: '2', name: 'B' }, { email: 'a', name: 'A', id: '1' }], now: 2 });
    expect(fileFingerprint(a)).toBe(fileFingerprint(b));
    expect(fileFingerprint(buildPeopleFile({ friends: [{ id: '1', name: 'Changed' }] }))).not.toBe(fileFingerprint(a));
  });

  it('survives being stored in pieces', () => {
    // Random text doesn't compress, so this one really is split.
    const big = { friends: Array.from({ length: 3000 }, (_, i) => ({ id: `f${i}`, note: Array.from({ length: 40 }, () => Math.random().toString(36)).join('') })) };
    const chunks = toChunks(big);
    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(CHUNK_BYTES);
    expect(fromChunks(chunks)).toEqual(big);
  });

  it('warns on a wipe, not on a person or two leaving', () => {
    const was = { friends: 400, guests: 212, guestsV2: 0, reachOuts: 30 };
    expect(dropWarnings(was, { ...was, friends: 398 })).toEqual([]);
    expect(dropWarnings(was, { ...was, guests: 1 })).toEqual(['211 of 212 wedding guests are gone since the last backup']);
    expect(dropWarnings(undefined, was)).toEqual([]);
    expect(changesSince(was, { ...was, friends: 403, guests: 210 })).toEqual(['+3 contacts', '−2 wedding guests']);
  });

  it('finds only the contacts that are gone', () => {
    expect(missingFriends({ friends: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, ['a', 'c', 'new']).map((f) => f.id)).toEqual(['b']);
  });
});

describe('/api/people-backup', () => {
  it('the daily run writes a file, emails it to the owner as an attachment, and skips a day nothing changed', async () => {
    docs.set('users/u1', { ...owner, weddingContacts: guests(3), doctors: ['x'] });
    friends(4);
    const res = await cron();
    expect(res.body.saved).toEqual([{ uid: 'u1', friends: 4, guests: 3, guestsV2: 0, reachOuts: 0, emailed: true }]);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(owner.email);
    expect(sent[0].subject).toBe('Rally people backup · 2026-11-26 · 4 contacts, 3 guests');
    expect(sent[0].attachments[0].filename).toBe('rally-people-2026-11-26.json');
    const attached = JSON.parse(sent[0].attachments[0].content);
    expect(attached.friends).toHaveLength(4);
    expect(attached.friends[0].familyTree).toEqual({ parents: ['A'] });
    expect(attached.user.weddingContacts).toEqual(guests(3));
    expect(JSON.stringify(attached)).not.toContain('doctors');
    expect(days()[0]).toMatchObject({ emailed: true, chunks: 1, counts: { friends: 4 } });

    vi.setSystemTime(new Date('2026-11-27T09:40:00Z'));
    expect((await cron()).body.saved).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(days()).toHaveLength(1);
    // A quiet day still leaves a heartbeat, pointing at the newest file.
    expect(docs.get('peopleBackups/u1')).toEqual({ lastRunAt: Date.parse('2026-11-27T09:40:00Z'), lastFileAt: Date.parse('2026-11-26T09:40:00Z'), counts: { friends: 4, guests: 3, guestsV2: 0, reachOuts: 0 } });
  });

  it('flags a sharp drop in the subject and the message', async () => {
    docs.set('users/u1', { ...owner, weddingContacts: guests(40) });
    friends(2);
    await cron();
    vi.setSystemTime(new Date('2026-11-27T09:40:00Z'));
    docs.set('users/u1', { ...owner, weddingContacts: guests(1) });
    await cron();
    expect(sent[1].subject).toMatch(/^⚠️ Rally people backup/);
    expect(sent[1].html).toContain('39 of 40 wedding guests are gone since the last backup');
  });

  it('attaches the family-tree photos once, then again only when they change', async () => {
    docs.set('users/u1', owner);
    friends(1);
    docs.set('users/u1/familyPhotos/p1', { friendId: 'f0', data: 'data:image/jpeg;base64,AAAA' });
    await cron();
    expect(sent[0].attachments.map((a) => a.filename)).toEqual(['rally-people-2026-11-26.json', 'rally-people-photos-2026-11-26.json']);
    vi.setSystemTime(new Date('2026-11-27T09:40:00Z'));
    docs.set('users/u1/friends/f9', { name: 'New' });
    await cron();
    expect(sent[1].attachments).toHaveLength(1);
    vi.setSystemTime(new Date('2026-11-28T09:40:00Z'));
    docs.set('users/u1/friends/f10', { name: 'Newer' });
    docs.set('users/u1/familyPhotos/p2', { friendId: 'f9', data: 'data:image/jpeg;base64,BBBB' });
    await cron();
    expect(sent[2].attachments).toHaveLength(2);
  });

  it('backs up other accounts without emailing them, unless they asked', async () => {
    docs.set('users/u1', { email: 'someone@x.test' });
    friends(2);
    docs.set('users/u2', { email: 'opted@x.test', peopleBackup: { email: true } });
    friends(1, 'u2');
    docs.set('users/u3', { email: 'empty@x.test' });
    const res = await cron();
    expect(res.body.saved.map((s) => [s.uid, s.emailed])).toEqual([['u1', false], ['u2', true]]);
    expect(sent.map((m) => m.to)).toEqual(['opted@x.test']);
    expect(days('u3')).toEqual([]);
  });

  it('the owner can switch the email off; a failed send is recorded, and the file is kept', async () => {
    docs.set('users/u1', { ...owner, peopleBackup: { email: false } });
    friends(2);
    await cron();
    expect(sent).toHaveLength(0);
    mailOk = false;
    docs.set('users/u1', owner);
    docs.set('users/u1/friends/f5', { name: 'More' });
    vi.setSystemTime(new Date('2026-11-27T09:40:00Z'));
    const res = await cron();
    expect(res.body.saved[0]).toMatchObject({ emailed: false, emailError: 'refused' });
    expect(days()).toHaveLength(2);
  });

  it('lists, downloads, and puts back only the contacts that went missing', async () => {
    docs.set('users/u1', owner);
    friends(3);
    const run = await call({ action: 'run' });
    expect(run.body).toMatchObject({ saved: true, file: { counts: { friends: 3 }, reason: 'manual' } });
    expect(sent).toHaveLength(0);
    expect((await call({ action: 'run' })).body.saved).toBe(false);

    const listed = await call({ action: 'list' });
    expect(listed.body).toMatchObject({ email: true, emailTo: owner.email, mail: true });
    const { id } = listed.body.files[0];

    const dl = await call({ action: 'download', id });
    expect(dl.body.filename).toBe('rally-people-2026-11-26.json');
    expect(JSON.parse(dl.body.json).friends).toHaveLength(3);

    docs.delete('users/u1/friends/f1');
    docs.set('users/u1/friends/f0', { name: 'Edited since' });
    const res = await call({ action: 'restoreMissing', id });
    expect(res.body).toEqual({ restored: 1, names: ['Friend 1'] });
    expect(docs.get('users/u1/friends/f1')).toEqual({ name: 'Friend 1', email: 'f1@x.test', familyTree: { parents: ['A'] } });
    expect(docs.get('users/u1/friends/f0')).toEqual({ name: 'Edited since' });
    expect((await call({ action: 'restoreMissing', id })).body.restored).toBe(0);
  });

  it('needs a signed-in user, a real backup, and the cron secret when one is set', async () => {
    expect((await call({ action: 'list' }, { token: 'nope' })).code).toBe(401);
    expect((await call({ action: 'download', id: 'missing' })).code).toBe(404);
    expect((await call({ action: 'download' })).code).toBe(400);
    process.env.CRON_SECRET = 'shh';
    expect((await call(undefined, { method: 'GET', auth: 'Bearer wrong' })).code).toBe(401);
  });

  it('thins out old files, pieces included', async () => {
    docs.set('users/u1', owner);
    friends(1);
    const old = Date.parse('2026-11-10T08:00:00Z');
    docs.set('peopleBackups/u1/days/a', { at: old, fingerprint: 'a', chunks: 1 });
    docs.set('peopleBackups/u1/days/a/chunks/0', { data: 'x' });
    docs.set('peopleBackups/u1/days/b', { at: old + 3600000, fingerprint: 'b', chunks: 1 });
    docs.set('peopleBackups/u1/days/b/chunks/0', { data: 'y' });
    await cron();
    expect(days().map((d) => d.id).sort()).toEqual(['auto1', 'b']);
    expect(docs.has('peopleBackups/u1/days/a/chunks/0')).toBe(false);
    expect(docs.has('peopleBackups/u1/days/b/chunks/0')).toBe(true);
  });
});
