/* global Buffer */
import { describe, it, expect, vi, afterEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { basicVenues, scanInbox, aiFailureReason, SCAN_MODEL, buildGmailQuery, gmailRefFromUrl, readEmail } from './weddingVenueScan.js';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const msg = ({ from, to = 'jo@gmail.com', subject = 'Wedding inquiry', body = '', date = '2026-10-05T12:00:00Z', labels = [], extra = {} }) => ({
  internalDate: String(new Date(date).getTime()),
  labelIds: labels,
  payload: {
    mimeType: 'text/plain',
    headers: [
      { name: 'From', value: from }, { name: 'To', value: to }, { name: 'Subject', value: subject },
      ...Object.entries(extra).map(([name, value]) => ({ name, value })),
    ],
    body: { data: b64(body) },
  },
});
const thread = (id, ...messages) => ({ id, messages });
const OWN = 'jo@gmail.com';

describe('basicVenues — rows made without the AI reader', () => {
  it('makes one row per venue address, from the headers and a few patterns', () => {
    const rows = basicVenues([
      thread('t1',
        msg({ from: 'Jo <jo@gmail.com>', to: 'events@ohekacastle.com', date: '2026-10-01T12:00:00Z' }),
        msg({ from: '"Sarah Jones" <sarah@events.ohekacastle.com>', subject: 'Re: Wedding inquiry', date: '2026-10-03T12:00:00Z',
          body: 'Our site fee is $18,000 and dinner is $165 per person.\nCall me at (631) 555-0142.' })),
    ], OWN);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Ohekacastle', contactName: 'Sarah Jones', email: 'sarah@events.ohekacastle.com',
      website: 'https://ohekacastle.com', phone: '(631) 555-0142', status: 'Replied',
      lastContactDate: '2026-10-03', threadIds: ['t1'],
      venueFeeLow: null, perPersonLow: null, location: '', capacity: '',
    });
    expect(rows[0].price).toBe('$18,000, $165 per person');
    expect(rows[0].summary).toContain('Added without AI reading');
    expect(rows[0].summary).toContain('Wedding inquiry');
  });

  it('merges several threads with the same venue domain into one row', () => {
    const rows = basicVenues([
      thread('t1', msg({ from: 'Ann <ann@thefoundry.com>', date: '2026-09-01T12:00:00Z', subject: 'Tour times' })),
      thread('t2', msg({ from: 'Bob <bob@thefoundry.com>', date: '2026-10-09T12:00:00Z', subject: 'Your proposal' })),
    ], OWN);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Thefoundry', contactName: 'Bob', threadIds: ['t1', 't2'], lastContactDate: '2026-10-09' });
    expect(rows[0].summary).toContain('Your proposal');
  });

  it('keeps people on shared mail domains apart, named as they sign, with no website guessed', () => {
    const rows = basicVenues([
      thread('t1', msg({ from: 'Maple Barn <maplebarn@gmail.com>' })),
      thread('t2', msg({ from: 'Rose Hall Events <rosehall@gmail.com>' })),
    ], OWN);
    expect(rows.map((r) => r.name)).toEqual(['Maple Barn', 'Rose Hall Events']);
    expect(rows.every((r) => r.website === '' && r.contactName === '')).toBe(true);
  });

  it('an inquiry nobody has answered yet is a row for whoever it was sent to', () => {
    const rows = basicVenues([thread('t1', msg({ from: 'Jo <jo@gmail.com>', to: 'hello@pridwin.com' }))], OWN);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Pridwin', email: 'hello@pridwin.com', status: 'Inquired', phone: '', price: '' });
  });

  it('skips mailing lists, promotions and automated senders', () => {
    const rows = basicVenues([
      thread('t1', msg({ from: 'The Knot <news@theknot.com>', extra: { 'List-Unsubscribe': '<mailto:x@y.com>' } })),
      thread('t2', msg({ from: 'Deals <offers@bigvenue.com>', labels: ['CATEGORY_PROMOTIONS'] })),
      thread('t3', msg({ from: 'no-reply@tripleseat.com' })),
      thread('t4', msg({ from: 'Jo <jo@gmail.com>', to: 'jo@gmail.com' })),
      thread('t5'),
    ], OWN);
    expect(rows).toEqual([]);
  });

  it('takes no phone or amounts from the couple’s own messages', () => {
    const rows = basicVenues([
      thread('t1',
        msg({ from: 'Jo <jo@gmail.com>', to: 'hi@oakroom.com', body: 'Our budget is $30,000. Reach me at 212-555-0100.' }),
        msg({ from: 'Oak Room <hi@oakroom.com>', body: 'Thanks, we will be in touch.' })),
    ], OWN);
    expect(rows[0]).toMatchObject({ phone: '', price: '' });
  });
});

describe('scanInbox', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  // 25 threads from 25 venues, so three reading batches (10, 10, 5).
  const stubGmail = (n = 25) => {
    const all = Array.from({ length: n }, (_, i) => thread(`t${i}`, msg({ from: `Venue ${i} <hi@venue${i}.com>` })));
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const id = String(url).match(/\/threads\/([^?]+)\?format=full/)?.[1];
      const body = id ? all.find((t) => t.id === id) : { threads: all.map((t) => ({ id: t.id })) };
      return { ok: true, json: async () => body };
    }));
  };

  it('reads with the small model by default', () => {
    expect(SCAN_MODEL).toBe('claude-haiku-5-5');
  });

  it('returns what the reader found, and says the reader was used', async () => {
    stubGmail();
    const read = vi.fn(async (texts) => texts.map((_, i) => ({ name: `Read ${i}` })));
    const out = await scanInbox('tok', { read, ownEmail: OWN });
    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls[0][0][0]).toContain('<thread id="t0">');
    expect(out).toMatchObject({ threadCount: 25, ai: null });
    expect(out.venues).toHaveLength(25);
  });

  it('falls back to basic rows for every thread when the reader has no credit', async () => {
    stubGmail();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const read = vi.fn(async () => { throw new Error('400 Your credit balance is too low to access the Anthropic API.'); });
    const out = await scanInbox('tok', { read, ownEmail: OWN });
    expect(out.threadCount).toBe(25);
    expect(out.ai).toEqual({ error: 'Rally’s AI credit has run out', threads: 25 });
    expect(out.venues).toHaveLength(25);
    expect(out.venues[0]).toMatchObject({ name: 'Venue0', email: 'hi@venue0.com', status: 'Replied' });
  });

  it('keeps what was read before a failure, and stops asking after it', async () => {
    stubGmail(45); // five batches: three in the first round, two in the second
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let n = 0;
    const read = vi.fn(async (texts) => {
      n += 1;
      if (n === 2) throw new Error('boom');
      return texts.map((t) => ({ name: `Read ${t.match(/id="(t\d+)"/)[1]}` }));
    });
    const out = await scanInbox('tok', { read, ownEmail: OWN });
    expect(read).toHaveBeenCalledTimes(3); // the second round is never asked
    expect(out.ai).toEqual({ error: 'the AI reading step failed', threads: 25 });
    expect(out.venues.filter((v) => v.name.startsWith('Read '))).toHaveLength(20);
    expect(out.venues.filter((v) => v.summary?.startsWith('Added without AI'))).toHaveLength(25);
  });
});

describe('aiFailureReason', () => {
  const apiError = (Cls, status, message) => new Cls(status, { type: 'error', error: { type: 'x', message } }, message, new Headers());
  it('puts the failure in words for the page', () => {
    expect(aiFailureReason(apiError(Anthropic.BadRequestError, 400, 'Your credit balance is too low to access the Anthropic API.'))).toBe('Rally’s AI credit has run out');
    expect(aiFailureReason(apiError(Anthropic.AuthenticationError, 401, 'invalid x-api-key'))).toBe('Rally’s AI key was refused');
    expect(aiFailureReason(apiError(Anthropic.RateLimitError, 429, 'slow down'))).toBe('the AI service is rate-limiting Rally');
    expect(aiFailureReason(apiError(Anthropic.InternalServerError, 500, 'oops'))).toBe('the AI service returned an error (500)');
    expect(aiFailureReason(new Anthropic.APIConnectionError({ message: 'offline' }))).toBe('the AI service could not be reached');
    expect(aiFailureReason(new TypeError('x is not a function'))).toBe('the AI reading step failed');
  });
});

describe('buildGmailQuery', () => {
  it('still searches two years back without a last-scan date', () => {
    expect(buildGmailQuery()).toContain('newer_than:2y');
    expect(buildGmailQuery(new Date('2026-10-10T12:00:00Z'))).toContain('after:2026/10/9');
  });
});

describe('one dropped email', () => {
  it('finds the thread or message a Gmail link names, when it names one', () => {
    expect(gmailRefFromUrl('https://mail.google.com/mail/u/0/#inbox/18C2f3a9b0d1e2f3')).toEqual({ threadId: '18c2f3a9b0d1e2f3' });
    expect(gmailRefFromUrl('https://mail.google.com/mail/u/1/#label/Wedding+Venues/18c2f3a9b0d1e2f3')).toEqual({ threadId: '18c2f3a9b0d1e2f3' });
    expect(gmailRefFromUrl('https://mail.google.com/mail/?ui=2&ik=abc&view=pt&th=18c2f3a9b0d1e2f3')).toEqual({ threadId: '18c2f3a9b0d1e2f3' });
    expect(gmailRefFromUrl('https://mail.google.com/mail/u/0/?ik=abc&view=om&permmsgid=msg-f:1784000000000000001')).toEqual({ messageId: (1784000000000000001n).toString(16) });
    // Today's links don't say, and other sites aren't Gmail.
    expect(gmailRefFromUrl('https://mail.google.com/mail/u/0/#inbox/FMfcgzQXJWDsKmzzvlPdkTbWqfHcTHtB')).toBeNull();
    expect(gmailRefFromUrl('https://example.com/#inbox/18c2f3a9b0d1e2f3')).toBeNull();
  });

  it('reads pasted text as one thread, tells the reader today, and drops the stand-in id', async () => {
    const read = vi.fn(async () => [{ name: 'The Foundry', lastContactDate: '', threadIds: ['dropped'] }, { name: 'Oheka', lastContactDate: '2026-11-02', threadIds: ['dropped'] }]);
    const out = await readEmail('Hi Jo, our fee is $18,000.', { today: '2026-11-18', read });
    const [texts, opts] = read.mock.calls[0];
    expect(texts).toEqual(['<thread id="dropped">\nHi Jo, our fee is $18,000.\n</thread>']);
    expect(opts.note).toContain('Today is 2026-11-18');
    expect(out.map((v) => [v.lastContactDate, v.threadIds])).toEqual([['2026-11-18', []], ['2026-11-02', []]]);
  });

  it('a thread from the inbox keeps its own id', async () => {
    const read = vi.fn(async () => [{ name: 'The Foundry', lastContactDate: '2026-11-17', threadIds: ['t9'] }]);
    const out = await readEmail('<thread id="t9">…</thread>', { today: '2026-11-18', threadId: 't9', read });
    expect(read.mock.calls[0][0]).toEqual(['<thread id="t9">…</thread>']);
    expect(out[0].threadIds).toEqual(['t9']);
    expect(await readEmail('   ', { read })).toEqual([]);
  });
});
