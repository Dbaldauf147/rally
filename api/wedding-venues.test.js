/* global process, Buffer */
// The Venues tab's Gmail endpoint and the callback half, against an in-memory
// Firestore, with Google and the inbox scan stubbed out.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const docs = new Map();
const DELETE = { __delete: true };
const STAMP = { __stamp: true };
const mergeInto = (cur = {}, patch) => {
  const out = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (v === DELETE) delete out[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && v !== STAMP) out[k] = mergeInto(out[k], v);
    else out[k] = v === STAMP ? { toDate: () => new Date('2026-11-01T00:00:00Z'), toMillis: () => Date.now() } : v;
  }
  return out;
};
const db = {
  collection: (name) => ({
    get: async () => ({
      docs: [...docs.entries()].filter(([k]) => k.startsWith(`${name}/`) && k.split('/').length === 2)
        .map(([k, v]) => ({ id: k.split('/')[1], data: () => v })),
    }),
  }),
  doc: (path) => ({
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    set: async (data, opts) => {
      if (opts?.merge) docs.set(path, mergeInto(docs.get(path), data));
      else if (opts?.mergeFields) {
        const cur = { ...(docs.get(path) || {}) };
        for (const f of opts.mergeFields) cur[f] = mergeInto({}, { [f]: data[f] })[f];
        docs.set(path, cur);
      } else docs.set(path, mergeInto({}, data));
    },
    delete: async () => { docs.delete(path); },
  }),
};

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), cert: vi.fn(), getApps: () => [{}] }));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: async (t) => { if (t !== 'good') throw new Error('bad'); return { uid: 'u1' }; } }),
}));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => db, FieldValue: { delete: () => DELETE, serverTimestamp: () => STAMP } }));
const scanInbox = vi.fn();
let refreshResult = async () => 'access-1';
vi.mock('../lib/weddingVenueScan.js', () => ({
  scanInbox: (...a) => scanInbox(...a),
  refreshAccessToken: (...a) => refreshResult(...a),
  threadText: (t) => `<thread id="${t.id}"></thread>`,
}));
const writeReply = vi.fn();
vi.mock('../lib/weddingVenueDraft.js', async (orig) => ({ ...(await orig()), writeReply: (...a) => writeReply(...a) }));

const { default: handler, isAutoScanDue } = await import('./wedding-venues.js');
const { finishGmailConnect } = await import('../lib/weddingGmailAuth.js');

const call = async (body, token = 'good') => {
  const res = { status(c) { res.code = c; return res; }, json(b) { res.body = b; return res; } };
  await handler({ method: 'POST', headers: { authorization: `Bearer ${token}`, host: 'rally.test', 'x-forwarded-proto': 'https' }, body }, res);
  return res;
};

beforeEach(() => {
  docs.clear();
  scanInbox.mockReset();
  refreshResult = async () => 'access-1';
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('api/wedding-venues', () => {
  it('needs a signed-in user', async () => {
    expect((await call({ action: 'scan' }, 'nope')).code).toBe(401);
  });

  it('connect hands back a Google URL for read-only Gmail on the existing callback', async () => {
    const res = await call({ action: 'connect', loginHint: 'jodanbaldauf@gmail.com' });
    expect(res.code).toBe(200);
    const url = new URL(res.body.url);
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose');
    expect(url.searchParams.get('redirect_uri')).toBe('https://rally.test/api/google-callback');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('login_hint')).toBe('jodanbaldauf@gmail.com');
    const nonce = url.searchParams.get('state').replace(/^gmail\./, '');
    expect(docs.get(`weddingGmailOAuth/${nonce}`).uid).toBe('u1');
  });

  it('scan without a linked inbox says so', async () => {
    const res = await call({ action: 'scan' });
    expect(res.code).toBe(409);
    expect(res.body.code).toBe('not_connected');
  });

  it('scan reads since the last scan and stamps it', async () => {
    docs.set('weddingGmailTokens/u1', { refreshToken: 'r1', email: 'jo@gmail.com' });
    docs.set('users/u1', { weddingGmail: { email: 'jo@gmail.com', lastScanAt: { toDate: () => new Date('2026-10-01T00:00:00Z') } } });
    scanInbox.mockResolvedValue({ venues: [{ name: 'The Foundry' }], threadCount: 4 });
    const res = await call({ action: 'scan' });
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ venues: [{ name: 'The Foundry' }], threadCount: 4, account: 'jo@gmail.com' });
    expect(scanInbox).toHaveBeenCalledWith('access-1', { since: new Date('2026-10-01T00:00:00Z') });
    expect(docs.get('users/u1').weddingGmail.email).toBe('jo@gmail.com');
    expect(docs.get('users/u1').weddingGmail.lastScanAt.toDate()).toEqual(new Date('2026-11-01T00:00:00Z'));
  });

  it('a full rescan ignores the last scan date', async () => {
    docs.set('weddingGmailTokens/u1', { refreshToken: 'r1', email: 'jo@gmail.com' });
    docs.set('users/u1', { weddingGmail: { email: 'jo@gmail.com', lastScanAt: { toDate: () => new Date('2026-10-01') } } });
    scanInbox.mockResolvedValue({ venues: [], threadCount: 0 });
    await call({ action: 'scan', full: true });
    expect(scanInbox).toHaveBeenCalledWith('access-1', { since: null });
  });

  it('an expired or revoked connection is forgotten', async () => {
    docs.set('weddingGmailTokens/u1', { refreshToken: 'r1', email: 'jo@gmail.com' });
    docs.set('users/u1', { weddingGmail: { email: 'jo@gmail.com' }, weddingVenues: [{ name: 'Keep me' }] });
    refreshResult = async () => { const e = new Error('Token has been expired or revoked.'); e.code = 'invalid_grant'; throw e; };
    const res = await call({ action: 'scan' });
    expect(res.code).toBe(409);
    expect(docs.has('weddingGmailTokens/u1')).toBe(false);
    expect(docs.get('users/u1').weddingGmail).toBeUndefined();
    expect(docs.get('users/u1').weddingVenues).toEqual([{ name: 'Keep me' }]);
  });

  it('disconnect revokes and forgets', async () => {
    docs.set('weddingGmailTokens/u1', { refreshToken: 'r1' });
    docs.set('users/u1', { weddingGmail: { email: 'jo@gmail.com' } });
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await call({ action: 'disconnect' })).code).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toContain('oauth2.googleapis.com/revoke?token=r1');
    expect(docs.has('weddingGmailTokens/u1')).toBe(false);
    expect(docs.get('users/u1').weddingGmail).toBeUndefined();
  });
});

describe('importing from Google Maps links', () => {
  const realKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  const FULL = 'https://www.google.com/maps/place/Oheka+Castle+Hotel+%26+Estate,+135+W+Gate+Dr,+Huntington,+NY+11743/data=!4m2!3m1!1s0x1:0x2';
  const redirect = (to) => ({ status: 302, ok: false, headers: { get: (h) => (h === 'location' ? to : null) } });
  const json = (body, ok = true) => ({ status: ok ? 200 : 403, ok, headers: { get: () => null }, json: async () => body });
  afterEach(() => {
    if (realKey === undefined) delete process.env.GOOGLE_MAPS_SERVER_KEY; else process.env.GOOGLE_MAPS_SERVER_KEY = realKey;
    delete process.env.VITE_GOOGLE_MAPS_EMBED_KEY;
  });

  it('follows a short link and reads the place from it when there is no key', async () => {
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    const fetchMock = vi.fn(async () => redirect(FULL));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call({ action: 'mapsImport', urls: ['https://maps.app.goo.gl/AbC123'] });
    expect(res.code).toBe(200);
    expect(res.body.places).toEqual([{ url: 'https://maps.app.goo.gl/AbC123', name: 'Oheka Castle Hotel & Estate', address: '135 W Gate Dr, Huntington, NY 11743', phone: '', website: '', mapsUrl: FULL, source: 'link' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('asks Google Places for the phone and website when the key allows it', async () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = 'k';
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url).includes('places.googleapis.com')) {
        expect(init.headers['X-Goog-Api-Key']).toBe('k');
        expect(JSON.parse(init.body).textQuery).toContain('Oheka Castle');
        return json({ places: [{ displayName: { text: 'Oheka Castle' }, formattedAddress: '135 W Gate Dr, Huntington, NY 11743, USA', nationalPhoneNumber: '(631) 659-1400', websiteUri: 'https://www.oheka.com/' }] });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const [place] = (await call({ action: 'mapsImport', urls: [FULL] })).body.places;
    expect(place).toMatchObject({ name: 'Oheka Castle', address: '135 W Gate Dr, Huntington, NY 11743, USA', phone: '(631) 659-1400', website: 'https://www.oheka.com/', source: 'places', mapsUrl: FULL });
  });

  it('falls back to the older Places API, then to an address for the pin, then to the link alone', async () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = 'k';
    const PIN = 'https://www.google.com/maps/place/The+Foundry/@40.75,-73.95,17z/data=!3d40.7501!4d-73.9498';
    const denied = { status: 'REQUEST_DENIED' };
    let mode = 'legacy';
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('places.googleapis.com')) return json({ error: { status: 'PERMISSION_DENIED' } }, false);
      if (u.includes('findplacefromtext')) return json(mode === 'legacy' ? { status: 'OK', candidates: [{ place_id: 'ChIJ1' }] } : denied);
      if (u.includes('place/details')) return json({ status: 'OK', result: { name: 'The Foundry', formatted_address: '42-38 9th St, Queens, NY', formatted_phone_number: '(718) 786-7776', website: 'https://thefoundry.nyc', url: 'https://maps.google.com/?cid=1' } });
      if (u.includes('geocode')) {
        expect(new URL(u).searchParams.get('latlng')).toBe('40.7501,-73.9498');
        return json(mode === 'geocode' ? { status: 'OK', results: [{ formatted_address: '42-38 9th St, Long Island City, NY 11101, USA' }] } : denied);
      }
      throw new Error(`unexpected ${u}`);
    }));
    expect((await call({ action: 'mapsImport', urls: [PIN] })).body.places[0]).toMatchObject({ name: 'The Foundry', phone: '(718) 786-7776', source: 'places', mapsUrl: PIN });
    mode = 'geocode';
    expect((await call({ action: 'mapsImport', urls: [PIN] })).body.places[0]).toMatchObject({ name: 'The Foundry', address: '42-38 9th St, Long Island City, NY 11101, USA', phone: '', source: 'geocode' });
    mode = 'none';
    expect((await call({ action: 'mapsImport', urls: [PIN] })).body.places[0]).toMatchObject({ name: 'The Foundry', address: '', source: 'link' });
  });

  it('never follows a link, or a redirect, off Google', async () => {
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    const fetchMock = vi.fn(async (url) => (String(url).includes('goo.gl') ? redirect('https://169.254.169.254/latest/meta-data') : json({})));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call({ action: 'mapsImport', urls: ['https://evil.example/maps/place/X', 'https://maps.app.goo.gl/AbC', 'https://www.google.com/maps'] });
    expect(res.body.places.map((p) => p.error)).toEqual([
      'That isn’t a Google Maps link', 'That link leads somewhere other than Google Maps', 'That link doesn’t point at a place',
    ]);
    // Only the two Google addresses were ever fetched.
    expect(fetchMock.mock.calls.map((c) => new URL(c[0]).hostname).sort()).toEqual(['maps.app.goo.gl', 'www.google.com']);
  });

  it('unwraps the cookie notice, needs a link, and needs a signed-in user', async () => {
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    vi.stubGlobal('fetch', vi.fn(async () => redirect(`https://consent.google.com/m?continue=${encodeURIComponent(FULL)}&gl=DE`)));
    expect((await call({ action: 'mapsImport', urls: ['https://maps.app.goo.gl/AbC'] })).body.places[0]).toMatchObject({ name: 'Oheka Castle Hotel & Estate', mapsUrl: FULL });
    expect((await call({ action: 'mapsImport', urls: [] })).code).toBe(400);
    expect((await call({ action: 'mapsImport', urls: [FULL] }, 'nope')).code).toBe(401);
  });
});

describe('finishGmailConnect', () => {
  const google = (overrides = {}) => vi.fn(async (url) => ({
    json: async () => (String(url).includes('/token')
      ? { access_token: 'a', refresh_token: 'r-new', scope: 'https://www.googleapis.com/auth/gmail.readonly', ...overrides }
      : { emailAddress: 'jodanbaldauf@gmail.com' }),
  }));

  it('stores the refresh token server-side and only the address on the user doc', async () => {
    docs.set('weddingGmailOAuth/n1', { uid: 'u1', createdAt: { toMillis: () => Date.now() } });
    docs.set('users/u1', { weddingGmail: { email: 'old@gmail.com', lastScanAt: 'x' }, other: 1 });
    vi.stubGlobal('fetch', google());
    const out = await finishGmailConnect({ nonce: 'n1', code: 'c', redirectUri: 'https://rally.test/api/google-callback' });
    expect(out).toEqual({ email: 'jodanbaldauf@gmail.com' });
    expect(docs.get('weddingGmailTokens/u1')).toMatchObject({ refreshToken: 'r-new', email: 'jodanbaldauf@gmail.com' });
    const user = docs.get('users/u1');
    expect(user.other).toBe(1);
    expect(user.weddingGmail.email).toBe('jodanbaldauf@gmail.com');
    expect(user.weddingGmail.lastScanAt).toBeUndefined();
    expect(JSON.stringify(user)).not.toContain('r-new');
    expect(docs.has('weddingGmailOAuth/n1')).toBe(false);
  });

  it('refuses an unknown or stale sign-in', async () => {
    vi.stubGlobal('fetch', google());
    await expect(finishGmailConnect({ nonce: 'nope', code: 'c', redirectUri: 'x' })).rejects.toThrow(/expired/);
    docs.set('weddingGmailOAuth/old', { uid: 'u1', createdAt: { toMillis: () => Date.now() - 60 * 60 * 1000 } });
    await expect(finishGmailConnect({ nonce: 'old', code: 'c', redirectUri: 'x' })).rejects.toThrow(/expired/);
  });

  it('refuses when Gmail access was not granted', async () => {
    docs.set('weddingGmailOAuth/n2', { uid: 'u1', createdAt: { toMillis: () => Date.now() } });
    vi.stubGlobal('fetch', google({ scope: 'openid' }));
    await expect(finishGmailConnect({ nonce: 'n2', code: 'c', redirectUri: 'x' })).rejects.toThrow(/Gmail read access/);
  });
});

describe('api/google-callback with a gmail. state', () => {
  const run = async (query) => {
    const { default: callback } = await import('./google-callback.js');
    const res = { headers: {}, status(c) { res.code = c; return res; }, setHeader(k, v) { res.headers[k] = v; return res; }, send(b) { res.body = b; return res; } };
    await callback({ query, headers: { host: 'rally.test', 'x-forwarded-proto': 'https' } }, res);
    return res;
  };

  it('links the inbox and tells the opener which one', async () => {
    docs.set('weddingGmailOAuth/n9', { uid: 'u1', createdAt: { toMillis: () => Date.now() } });
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      json: async () => (String(url).includes('/token')
        ? { access_token: 'a', refresh_token: 'r9', scope: 'https://www.googleapis.com/auth/gmail.readonly' }
        : { emailAddress: 'jodanbaldauf@gmail.com' }),
    })));
    const res = await run({ code: 'c', state: 'gmail.n9' });
    expect(res.body).toContain('"type":"gmail-connected"');
    expect(res.body).toContain('jodanbaldauf@gmail.com');
    expect(res.body).not.toContain('r9');
    expect(docs.get('weddingGmailTokens/u1').refreshToken).toBe('r9');
  });

  it('reports a failure without letting the message break out of the script', async () => {
    const res = await run({ error: '</script><img src=x>', state: 'gmail.zz' });
    expect(res.body).toContain('"type":"gmail-error"');
    expect(res.body).not.toContain('</script><img');
  });
});

describe('daily scheduled scan', () => {
  const get = async (now, headers = {}) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const res = { status(c) { res.code = c; return res; }, json(b) { res.body = b; return res; } };
      await handler({ method: 'GET', headers, body: {} }, res);
      return res;
    } finally {
      vi.useRealTimers();
    }
  };
  afterEach(() => { delete process.env.CRON_SECRET; });

  it('is due from 9 AM Eastern, once a day, unless switched off', () => {
    const g = { email: 'a@b.com' };
    expect(isAutoScanDue(g, new Date('2026-11-11T13:30:00Z'))).toBe(false); // 8:30 EST
    expect(isAutoScanDue(g, new Date('2026-11-11T14:05:00Z'))).toBe(true); // 9:05 EST
    expect(isAutoScanDue(g, new Date('2026-07-11T13:05:00Z'))).toBe(true); // 9:05 EDT
    expect(isAutoScanDue({ ...g, lastAutoScanDate: '2026-11-11' }, new Date('2026-11-11T14:05:00Z'))).toBe(false);
    expect(isAutoScanDue({ ...g, autoScan: false }, new Date('2026-11-11T14:05:00Z'))).toBe(false);
    expect(isAutoScanDue(null, new Date('2026-11-11T14:05:00Z'))).toBe(false);
  });

  it('scans each linked inbox and folds the venues into the saved list', async () => {
    docs.set('weddingGmailTokens/u1', { refreshToken: 'r1', email: 'a@b.com' });
    docs.set('users/u1', {
      weddingGmail: { email: 'a@b.com' },
      weddingVenues: [{ id: 'v1', name: 'The Foundry', perPersonLow: '$150', status: 'Inquired' }],
      weddingVenueDismissed: ['old barn'],
    });
    docs.set('users/u2', { name: 'not linked' });
    scanInbox.mockResolvedValue({
      threadCount: 3,
      venues: [
        { name: 'Foundry', venueFeeLow: 18000, venueFeeHigh: 21500, perPersonLow: 185, perPersonHigh: 205, allInclusive: 'No', status: 'Quote received', threadIds: ['t1'] },
        { name: 'Pridwin', venueFeeLow: null, venueFeeHigh: null, perPersonLow: 210, perPersonHigh: 210, allInclusive: 'Yes', status: 'Replied', threadIds: ['t2'] },
        { name: 'Old Barn', status: 'Replied', threadIds: ['t3'] },
      ],
    });
    const res = await get(new Date('2026-11-11T14:05:00Z'));
    expect(res.code).toBe(200);
    expect(res.body.scanned).toBe(1);
    const u = docs.get('users/u1');
    expect(u.weddingVenues.map((v) => v.name)).toEqual(['The Foundry', 'Pridwin']);
    expect(u.weddingVenues[0]).toMatchObject({ venueFeeLow: '$18,000', venueFeeHigh: '$21,500', perPersonLow: '$150', perPersonHigh: '$205', allInclusive: 'No', status: 'Quote received' });
    expect(u.weddingVenues[1]).toMatchObject({ venueFeeLow: '', perPersonLow: '$210', perPersonHigh: '$210' });
    expect(u.weddingVenues[1]).toMatchObject({ allInclusive: 'Yes', source: 'gmail' });
    expect(u.weddingGmail).toMatchObject({ lastAutoScanDate: '2026-11-11', lastAutoScan: { added: ['Pridwin'], updatedCount: 1 } });
    expect(u.weddingGmail.lastScanAt).toBeTruthy();

    // The second cron run the same day finds it done.
    scanInbox.mockClear();
    const again = await get(new Date('2026-11-11T15:00:00Z'));
    expect(again.body.scanned).toBe(0);
    expect(scanInbox).not.toHaveBeenCalled();
  });

  it('notes a failure on the user doc rather than throwing', async () => {
    docs.set('users/u1', { weddingGmail: { email: 'a@b.com' } });
    const res = await get(new Date('2026-11-11T14:05:00Z'));
    expect(res.code).toBe(200);
    expect(docs.get('users/u1').weddingGmail.lastAutoScan.error).toMatch(/Connect a Gmail inbox/);
  });

  it('wants the cron secret when one is set', async () => {
    process.env.CRON_SECRET = 'shh';
    expect((await get(new Date('2026-11-11T14:05:00Z'))).code).toBe(401);
    expect((await get(new Date('2026-11-11T14:05:00Z'), { authorization: 'Bearer shh' })).code).toBe(200);
  });
});

describe('drafting venue replies', () => {
  const h = (name, value) => ({ name, value });
  const thread = {
    id: 'th1',
    messages: [
      { internalDate: '1000', payload: { headers: [h('From', 'Dan <dan@inbox.test>'), h('Subject', 'Wedding inquiry'), h('Message-ID', '<m1@x>')] } },
      { internalDate: '2000', payload: { headers: [h('From', 'Trudy Wilson <twilson@pridwin.test>'), h('Subject', 'RE: Wedding inquiry'), h('Message-ID', '<m2@x>'), h('References', '<m1@x>')] } },
      { internalDate: '3000', payload: { headers: [h('From', 'dan@inbox.test'), h('Subject', 'Re: Wedding inquiry'), h('Message-ID', '<m3@x>')] } },
    ],
  };
  let gmailCalls;
  beforeEach(() => {
    writeReply.mockReset();
    gmailCalls = [];
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      gmailCalls.push({ url: String(url), opts });
      if (String(url).includes('/threads/th1')) return { ok: true, json: async () => thread };
      if (String(url).endsWith('/drafts')) return { ok: true, json: async () => ({ id: 'd1', message: { id: 'm9', threadId: 'th1' } }) };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    docs.set('weddingGmailTokens/u1', { refreshToken: 'r1', email: 'dan@inbox.test' });
    docs.set('users/u1', {
      weddingGmail: { email: 'dan@inbox.test' },
      weddingVenues: [
        { id: 'v1', name: 'The Pridwin', contactName: 'Trudy Wilson', email: 'twilson@pridwin.test', threadIds: ['th1'] },
        { id: 'v2', name: 'Regatta Place', threadIds: [] },
      ],
      weddingVenueReply: { details: { couple: 'Dan & Jo', guests: 'About 180' }, template: 'Hi {first name},\n\nWe love {venue}.' },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('drafts a new outreach email to the venue, never a reply in its thread', async () => {
    const res = await call({ action: 'draftOutreach', venueId: 'v1' });
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({
      to: 'twilson@pridwin.test', subject: 'Wedding inquiry', threadId: '', inReplyTo: '', references: '',
      body: 'Hi Trudy,\n\nWe love The Pridwin.', tailored: false,
    });
    // It doesn't read the venue's threads or ask Claude to rewrite anything.
    expect(gmailCalls).toEqual([]);
    expect(writeReply).not.toHaveBeenCalled();
  });

  it('puts the date in the subject, opens "Hi there" with no contact, and answers to the old action name', async () => {
    docs.set('users/u1', { ...docs.get('users/u1'), weddingVenueReply: { details: { date: 'Saturday, September 18, 2027' }, template: 'Hi {first name},\n\nWe love {venue}.' } });
    const res = await call({ action: 'draftReply', venueId: 'v2' });
    expect(res.body).toMatchObject({ to: '', subject: 'Wedding inquiry for Saturday, September 18, 2027', body: 'Hi there,\n\nWe love Regatta Place.', threadId: '' });
    expect((await call({ action: 'draftOutreach', venueId: 'gone' })).code).toBe(404);
  });

  it('fills in whichever saved draft is asked for, and lists them to choose between', async () => {
    docs.set('users/u1', { ...docs.get('users/u1'), weddingVenueReply: {
      details: { couple: 'Dan & Jo' },
      drafts: [
        { id: 'outreach', name: 'Outreach', template: 'Hi {first name},\n\nWe love {venue}.' },
        { id: 'draft-2', name: 'Follow-up', template: 'Hi {first name},\n\nJust checking in on {venue}.', subject: 'Following up' },
      ],
    } });
    const first = await call({ action: 'draftOutreach', venueId: 'v1' });
    expect(first.body).toMatchObject({ templateId: 'outreach', subject: 'Wedding inquiry', body: 'Hi Trudy,\n\nWe love The Pridwin.' });
    expect(first.body.templates).toEqual([{ id: 'outreach', name: 'Outreach' }, { id: 'draft-2', name: 'Follow-up' }]);
    const second = await call({ action: 'draftOutreach', venueId: 'v1', templateId: 'draft-2' });
    expect(second.body).toMatchObject({ templateId: 'draft-2', subject: 'Following up', body: 'Hi Trudy,\n\nJust checking in on The Pridwin.' });
    // A draft deleted since the page loaded falls back to the first.
    expect((await call({ action: 'draftOutreach', venueId: 'v1', templateId: 'gone' })).body.templateId).toBe('outreach');
  });

  it('saves a Gmail draft in the thread, never sends', async () => {
    const res = await call({ action: 'saveDraft', to: 'twilson@pridwin.test', subject: 'Re: Pricing — Champlin’s', body: 'Hi!\nThanks', threadId: 'th1', inReplyTo: '<m2@x>', references: '<m1@x> <m2@x>' });
    expect(res.code).toBe(200);
    expect(res.body.draftId).toBe('d1');
    const post = gmailCalls.find((c) => c.url.endsWith('/drafts'));
    expect(gmailCalls.some((c) => /\/send/.test(c.url))).toBe(false);
    const sent = JSON.parse(post.opts.body);
    expect(sent.message.threadId).toBe('th1');
    const raw = Buffer.from(sent.message.raw, 'base64url').toString('utf8');
    expect(raw).toContain('To: twilson@pridwin.test');
    expect(raw).toContain('In-Reply-To: <m2@x>');
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?/);
    const body = raw.split('\r\n\r\n')[1];
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe('Hi!\r\nThanks');
    expect(docs.get('users/u1').weddingGmail.canDraft).toBe(true);
  });

  it('asks for a reconnect when the connection can only read', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'Request had insufficient authentication scopes.' } }) }));
    const res = await call({ action: 'saveDraft', to: 'a@b.test', subject: 's', body: 'b' });
    expect(res.code).toBe(409);
    expect(res.body.code).toBe('needs_compose');
    expect(docs.get('users/u1').weddingGmail.canDraft).toBe(false);
  });

  it('won\'t save a draft with no address or no body', async () => {
    expect((await call({ action: 'saveDraft', to: '', body: 'x' })).code).toBe(400);
    expect((await call({ action: 'saveDraft', to: 'a@b.test', body: '  ' })).code).toBe(400);
  });
});
