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
  // A backup that ran this morning, unless the test says otherwise (null: none).
  const docs = new Map(Object.entries({
    'peopleBackups/dan': { lastRunAt: Date.parse('2026-11-22T09:40:00Z'), lastFileAt: Date.parse('2026-11-20T09:40:00Z'), counts: { friends: 412, guests: 212 } },
    ...seed,
  }).filter(([, v]) => v !== null));
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

describe('weekly digest Secret Santa gifts', () => {
  const pair = (g, r) => ({ giver: { key: g, name: g }, receiver: { key: r, name: r } });
  const seed = (extra = {}) => ({
    'events/x': {
      title: 'Christmas', createdBy: 'dan', stage: 'finalized', secretSanta: { enabled: true }, date: '2026-12-25T17:00:00Z',
      members: { dan: { name: 'Dan' }, milan: { name: 'Milan <S>' }, amy: { name: 'Amy' } },
    },
    'users/dan': {
      secretSanta: { x: { 2026: { pairs: [pair('dan', 'milan'), pair('milan', 'amy'), pair('amy', 'dan')] } } },
      giftPeople: { x: [] },
    },
    'users/dan/friends/m': { name: 'Milan <S>', giftIdeas: ['Whisky https://shop.example/w'] },
    'users/dan/friends/j': { name: 'Joanne Seo', giftIdeas: ['Candle'] },
    'users/dan/friends/s': { name: 'Sally Baldauf' },
    ...extra,
  });

  it('shows my pick, then Joanne, Mom and Dad, with their gift ideas', async () => {
    db = fakeDb(seed());
    const res = await run();
    expect(res.body).toMatchObject({ sent: true, count: 0, birthdays: 0, gifts: 1 });
    const { subject, html } = mails[0];
    expect(subject).toBe('Rally: your Secret Santa gift list');
    expect(html).toContain('Secret Santa gifts');
    expect(html).toContain('href="https://rally-seven-theta.vercel.app/event/x"');
    expect(html).toContain('33 days');
    const order = ['Milan &lt;S&gt;', 'Joanne Seo', 'Sally Baldauf', 'Brian Baldauf'].map((n) => html.indexOf(n));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('>Mom<');
    expect(html).toContain('>Dad<');
    expect(html).toContain('<a href="https://shop.example/w" style="color:#4f46e5;">');
    expect(html).toContain('<li>Candle</li>');
    expect(html).toContain('No gift ideas yet'); // Sally
    expect(html).toContain('Not on your Friends page'); // Brian
    expect(html).not.toContain('Amy'); // someone else's pick stays out
  });

  it('says nothing before names are drawn', async () => {
    db = fakeDb(seed({ 'users/dan': {} }));
    const res = await run();
    expect(res.body.sent).toBe(false);
    expect(mails).toHaveLength(0);
  });
});

describe('weekly digest backup alarm', () => {
  it('says quietly that backups are running', async () => {
    db = fakeDb({ 'users/dan': {}, 'users/dan/friends/a': { name: 'Sally', birthday: '12-01', birthdayEmail: true } });
    await run();
    expect(mails[0].subject).toBe('Rally: 1 birthday coming up');
    expect(mails[0].html).toContain('Backups are running: last checked Sun, Nov 22, newest file Fri, Nov 20 (412 contacts, 212 guests).');
    expect(mails[0].html).not.toContain('Backups have stopped');
  });

  it('sends on an otherwise empty week when the backup has stopped', async () => {
    db = fakeDb({ 'users/dan': {}, 'peopleBackups/dan': { lastRunAt: Date.parse('2026-11-18T09:40:00Z'), lastErrorAt: Date.parse('2026-11-21T09:40:00Z'), lastError: 'quota' } });
    const res = await run();
    expect(res.body.sent).toBe(true);
    expect(mails[0].subject).toBe('⚠️ Rally: no backup since Wed, Nov 18');
    expect(mails[0].html).toContain('Backups have stopped.');
    expect(mails[0].html).toContain('has not run since Wed, Nov 18. Last error: quota');
  });

  it('warns when the backup has never run', async () => {
    db = fakeDb({ 'users/dan': {}, 'peopleBackups/dan': null });
    await run();
    expect(mails[0].subject).toBe('⚠️ Rally: the daily backup has never run');
  });
});

