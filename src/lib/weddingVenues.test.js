/* global Buffer */
import { describe, it, expect } from 'vitest';
import { mergeScannedVenues, sameVenue, venueNameKey, normalizeVenue, sortVenues, gmailThreadUrl } from './weddingVenues';
import { buildGmailQuery, dropQuoted, messageBody, threadText } from '../../lib/weddingVenueScan.js';

describe('venueNameKey / sameVenue', () => {
  it('ignores "the", punctuation and company suffixes', () => {
    expect(venueNameKey('The Foundry, LLC')).toBe('foundry');
    expect(sameVenue({ name: 'The Foundry' }, { name: 'foundry' })).toBe(true);
    expect(sameVenue({ name: 'Oheka Castle' }, { name: 'Oheka Castle Hotel & Estate' })).toBe(true);
  });

  it('matches on a venue email or company domain, not a free or listing domain', () => {
    expect(sameVenue({ name: 'A', email: 'maria@foundryli.com' }, { name: 'B', email: 'events@foundryli.com' })).toBe(true);
    expect(sameVenue({ name: 'A', email: 'x@gmail.com' }, { name: 'B', email: 'y@gmail.com' })).toBe(false);
    expect(sameVenue({ name: 'A', email: 'owner@gmail.com' }, { name: 'B', email: 'owner@gmail.com' })).toBe(true);
    expect(sameVenue({ name: 'Barn One', email: 'leads@theknot.com' }, { name: 'Loft Two', email: 'leads@theknot.com' })).toBe(false);
    expect(sameVenue({ name: 'Barn One', email: 'a@mail.weddingwire.com' }, { name: 'Loft Two', email: 'a@mail.weddingwire.com' })).toBe(false);
  });
});

describe('mergeScannedVenues', () => {
  const scanned = { name: 'The Foundry', contactName: 'Maria', email: 'Maria@FoundryLI.com', status: 'Replied', lastContactDate: '2026-10-04', threadIds: ['t1'], price: '$185/pp' };

  it('adds a new venue from a scan', () => {
    const { list, added } = mergeScannedVenues([], [scanned]);
    expect(added).toEqual(['The Foundry']);
    expect(list[0]).toMatchObject({ name: 'The Foundry', email: 'maria@foundryli.com', source: 'gmail', status: 'Replied' });
  });

  it('fills blanks but never overwrites what was typed', () => {
    const mine = normalizeVenue({ id: 'v1', name: 'Foundry', price: 'negotiated $160/pp', status: 'Researching' });
    const { list, updated } = mergeScannedVenues([mine], [scanned]);
    expect(updated).toEqual(['Foundry']);
    expect(list[0]).toMatchObject({ id: 'v1', name: 'Foundry', price: 'negotiated $160/pp', contactName: 'Maria', status: 'Replied', threadIds: ['t1'] });
  });

  it('moves status forward only, and keeps Booked / Not a fit', () => {
    const toured = normalizeVenue({ name: 'Foundry', status: 'Toured' });
    expect(mergeScannedVenues([toured], [{ ...scanned, status: 'Replied' }]).list[0].status).toBe('Toured');
    expect(mergeScannedVenues([toured], [{ ...scanned, status: 'Not a fit' }]).list[0].status).toBe('Not a fit');
    const booked = normalizeVenue({ name: 'Foundry', status: 'Booked' });
    expect(mergeScannedVenues([booked], [{ ...scanned, status: 'Not a fit' }]).list[0].status).toBe('Booked');
  });

  it('does not bring back a deleted venue', () => {
    expect(mergeScannedVenues([], [scanned], ['the foundry']).list).toEqual([]);
  });

  it('a repeat scan of the same mail changes nothing', () => {
    const once = mergeScannedVenues([], [scanned]).list;
    const twice = mergeScannedVenues(once, [scanned]);
    expect(twice.added).toEqual([]);
    expect(twice.updated).toEqual([]);
  });

  it('a newer email updates the date and summary', () => {
    const once = mergeScannedVenues([], [{ ...scanned, summary: 'old' }]).list;
    const r = mergeScannedVenues(once, [{ ...scanned, lastContactDate: '2026-10-20', summary: 'Tour booked', status: 'Tour scheduled', threadIds: ['t2'] }]);
    expect(r.list[0]).toMatchObject({ lastContactDate: '2026-10-20', summary: 'Tour booked', status: 'Tour scheduled', threadIds: ['t1', 't2'] });
  });
});

describe('sortVenues / gmailThreadUrl', () => {
  it('newest contact first, undated last', () => {
    const out = sortVenues([{ name: 'B' }, { name: 'A', lastContactDate: '2026-01-01' }, { name: 'C', lastContactDate: '2026-05-01' }]);
    expect(out.map((v) => v.name)).toEqual(['C', 'A', 'B']);
  });
  it('links to the thread in the right account', () => {
    expect(gmailThreadUrl('abc', 'jo@gmail.com')).toBe('https://mail.google.com/mail/u/jo%40gmail.com/#all/abc');
  });
});

describe('Gmail helpers', () => {
  const b64 = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

  it('builds an after: query from the last scan, else two years', () => {
    expect(buildGmailQuery(null)).toMatch(/newer_than:2y/);
    expect(buildGmailQuery(new Date('2026-11-08T12:00:00Z'))).toMatch(/after:2026\/11\/7/);
  });

  it('drops the quoted reply below "On … wrote:"', () => {
    expect(dropQuoted('Thanks!\n\nOn Fri, Oct 2, 2026 at 9:00 AM Jo <jo@x.com> wrote:\n> old text')).toBe('Thanks!\n');
  });

  it('prefers text/plain and strips HTML otherwise', () => {
    expect(messageBody({ mimeType: 'multipart/alternative', parts: [
      { mimeType: 'text/plain', body: { data: b64('plain one') } },
      { mimeType: 'text/html', body: { data: b64('<p>html</p>') } },
    ] })).toBe('plain one');
    const html = messageBody({ mimeType: 'text/html', body: { data: b64('<p>Hi &amp; welcome</p><br>Call (631) 555-0142') } });
    expect(html).toMatch(/^Hi & welcome\s+Call \(631\) 555-0142$/);
  });

  it('renders a thread with its id and headers', () => {
    const t = threadText({ id: 't9', messages: [{ internalDate: String(Date.parse('2026-10-04T12:00:00Z')), payload: {
      headers: [{ name: 'From', value: 'Maria <m@f.com>' }, { name: 'Subject', value: 'Re: tour' }], mimeType: 'text/plain', body: { data: b64('See you Saturday') },
    } }] });
    expect(t).toContain('<thread id="t9">');
    expect(t).toContain('From: Maria <m@f.com>');
    expect(t).toContain('Date: 2026-10-04');
    expect(t).toContain('See you Saturday');
  });
});

describe('scanInbox (Gmail stubbed)', () => {
  it('searches, fetches every thread, and reads them in batches of ten', async () => {
    const { scanInbox } = await import('../../lib/weddingVenueScan.js');
    const { vi } = await import('vitest');
    const ids = Array.from({ length: 23 }, (_, i) => ({ id: `t${i}` }));
    const urls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      urls.push(String(url));
      if (String(url).includes('/threads?')) return { ok: true, json: async () => ({ threads: ids }) };
      const id = String(url).match(/threads\/(t\d+)/)[1];
      return { ok: true, json: async () => ({ id, messages: [] }) };
    }));
    const batches = [];
    const out = await scanInbox('tok', { read: async (texts) => { batches.push(texts.length); return [{ name: `V${batches.length}` }]; } });
    vi.unstubAllGlobals();
    expect(out.threadCount).toBe(23);
    expect(batches).toEqual([10, 10, 3]);
    expect(out.venues.map((v) => v.name)).toEqual(['V1', 'V2', 'V3']);
    expect(decodeURIComponent(urls[0])).toContain('newer_than:2y');
  });
});

describe('details from a later email (Champlin’s: the guest count came in the second reply)', () => {
  const first = { name: "Champlin's Marina and Resort", status: 'Replied', lastContactDate: '2026-11-11', threadIds: ['t1'], capacity: 'Not specified' };
  const second = { ...first, capacity: '170 seated; more as cocktail-style', lastContactDate: '2026-11-12', availability: 'Sep 25, 2027 open' };

  it('a filler like "Not specified" is never saved, so the real number lands later', () => {
    const a = mergeScannedVenues([], [first]).list;
    expect(a[0].capacity).toBe('');
    const b = mergeScannedVenues(a, [second]).list;
    expect(b[0].capacity).toBe('170 seated; more as cocktail-style');
  });

  it('a filler saved by an older scan is filled over too', () => {
    const old = [normalizeVenue({ id: 'v1', name: "Champlin's Marina", capacity: 'N/A', source: 'gmail' })];
    expect(mergeScannedVenues(old, [second]).list[0].capacity).toBe('170 seated; more as cocktail-style');
  });

  it('a newer email updates what an earlier scan wrote', () => {
    const a = mergeScannedVenues([], [{ ...first, capacity: 'up to 250 standing' }]).list;
    const b = mergeScannedVenues(a, [second]);
    expect(b.list[0].capacity).toBe('170 seated; more as cocktail-style');
    expect(b.updated).toEqual(["Champlin's Marina and Resort"]);
    // …but an older email read later doesn't undo it.
    const c = mergeScannedVenues(b.list, [{ ...first, capacity: 'up to 250 standing' }]).list;
    expect(c[0].capacity).toBe('170 seated; more as cocktail-style');
  });

  it('a value typed over a scanned one is left alone', () => {
    const a = mergeScannedVenues([], [{ ...first, capacity: 'up to 250 standing' }]).list;
    const typed = [{ ...a[0], capacity: '160 (our number)' }];
    expect(mergeScannedVenues(typed, [second]).list[0].capacity).toBe('160 (our number)');
  });

  it('a venue saved before scans were remembered keeps its typed value', () => {
    const legacy = [normalizeVenue({ id: 'v1', name: "Champlin's Marina", capacity: '150' })];
    expect(mergeScannedVenues(legacy, [second]).list[0].capacity).toBe('150');
  });
});

describe('the Champlin’s reply reaches the reader', () => {
  it('keeps the guest count from an HTML-only Tripleseat message', () => {
    const html = '<table><tr><td>To:</td><td>Joanne Seo</td></tr></table><p>Absolutely! I have September 25th available!</p>'
      + '<p>For an event of this size we would not have formal seating, it would be more of a cocktail style event. '
      + 'We really max out at 170 for an event with arranged seating.</p><p>Please keep this when replying: [TS/818fxqz241t30mgfaffy]</p>';
    const thread = { id: 't1', messages: [{ internalDate: String(Date.UTC(2026, 10, 11, 16, 32)), payload: {
      headers: [{ name: 'From', value: 'Ryann Liguori <tpg.ryann.liguori@discussions.tripleseat.com>' }, { name: 'Subject', value: "Champlin's Marina and Resort: Lead Comment" }],
      mimeType: 'text/html', body: { data: Buffer.from(html).toString('base64url') },
    } }] };
    const text = threadText(thread);
    expect(text).toContain('We really max out at 170 for an event with arranged seating.');
    expect(text).toContain('Absolutely! I have September 25th available!');
  });
});
