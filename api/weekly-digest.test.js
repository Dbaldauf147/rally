// The weekly digest's birthdays section, against an in-memory Firestore with
// the mailer stubbed out.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mails = [];
let db;
vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), cert: vi.fn(), getApps: () => [{}] }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => db }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ getUserByEmail: async () => ({ uid: 'dan' }) }) }));
vi.mock('../lib/mailer.js', () => ({
  mailConfigured: () => true,
  sendOne: async (msg) => { mails.push(msg); return { ok: true, via: 'test' }; },
}));

const { default: handler } = await import('./weekly-digest.js');

// Just enough Firestore: docs by path, and equality / array-contains filters.
function fakeDb(seed) {
  const docs = new Map(Object.entries(seed));
  const ref = (path) => ({
    id: path.split('/').pop(),
    collection: (name) => col(`${path}/${name}`),
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
  });
  const col = (path, filters = []) => ({
    doc: (id) => ref(`${path}/${id}`),
    where: (field, op, value) => col(path, [...filters, (d) => (
      op === 'array-contains' ? (d[field] || []).includes(value) : d[field] === value)]),
    get: async () => ({
      docs: [...docs.entries()]
        .filter(([k]) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'))
        .filter(([, v]) => filters.every((f) => f(v)))
        .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v })),
    }),
  });
  return { collection: (name) => col(name) };
}

const run = async () => {
  const res = { status: (code) => { res.code = code; return res; }, json: (body) => { res.body = body; return res; } };
  await handler({ method: 'GET', query: {} }, res);
  return res;
};

beforeEach(() => {
  mails.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T14:00:00Z')); // the Sunday cron
});
afterEach(() => vi.useRealTimers());

describe('weekly digest birthdays', () => {
  it('lists opted-in birthdays within three weeks, with gift ideas', async () => {
    db = fakeDb({
      'users/dan': {},
      'users/dan/friends/a': { name: 'Sally <B>', birthday: '12-01', dob: '1960-12-01', birthdayEmail: true, giftIdeas: ['Garden gloves', 'Tea https://shop.example/tea?a=1&b=2.'] },
      'users/dan/friends/b': { name: 'No Ideas Ned', birthday: '12-13', birthdayEmail: true },
      'users/dan/friends/c': { name: 'Unticked Una', birthday: '11-25', giftIdeas: ['Secret'] },
      'users/dan/friends/d': { name: 'Far Off Fay', birthday: '12-14', birthdayEmail: true },
      'users/dan/friends/e': { name: 'Off Again Otto', birthday: '11-25', birthdayEmail: false },
    });
    const res = await run();
    expect(res.body).toMatchObject({ sent: true, count: 0, checkIns: 0, birthdays: 2 });
    const [mail] = mails;
    expect(mail.subject).toBe('Rally: 2 birthdays coming up');
    expect(mail.html).toContain('Sally &lt;B&gt;');
    expect(mail.html).toContain('turning 66');
    expect(mail.html).toContain('9 days');
    expect(mail.html).toContain('Tue, Dec 1');
    expect(mail.html).toContain('<li>Garden gloves</li>');
    expect(mail.html).toContain('<a href="https://shop.example/tea?a=1&amp;b=2" style="color:#4f46e5;">https://shop.example/tea?a=1&amp;b=2</a>.');
    expect(mail.html).toContain('No Ideas Ned');
    expect(mail.html).toContain('No gift ideas yet');
    expect(mail.html.indexOf('Sally')).toBeLessThan(mail.html.indexOf('No Ideas Ned'));
    for (const absent of ['Unticked Una', 'Secret', 'Far Off Fay', 'Off Again Otto']) expect(mail.html).not.toContain(absent);
  });

  it('shares the email with unscheduled events', async () => {
    db = fakeDb({
      'events/e1': { title: 'Ski trip', createdBy: 'dan', members: {} },
      'users/dan': {},
      'users/dan/friends/a': { name: 'Sally', birthday: '11-22', birthdayEmail: true },
    });
    const res = await run();
    expect(res.body).toMatchObject({ sent: true, count: 1, birthdays: 1 });
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe('Rally: 1 event still needs scheduling · 1 birthday coming up');
    expect(mails[0].html).toContain('Ski trip');
    expect(mails[0].html).toContain('Birthdays coming up');
    expect(mails[0].html).toContain('>today<');
  });

  it('sends nothing when there is nothing to say', async () => {
    db = fakeDb({ 'users/dan': {}, 'users/dan/friends/c': { name: 'Unticked Una', birthday: '11-25' } });
    const res = await run();
    expect(res.body.sent).toBe(false);
    expect(mails).toHaveLength(0);
  });
});
