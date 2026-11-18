/* global Buffer */
import { describe, it, expect, vi, afterEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { basicVenues, scanInbox, aiFailureReason, SCAN_MODEL, buildGmailQuery, gmailRefFromUrl, readEmail, basicEmailVenue } from './weddingVenueScan.js';

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
    expect(out.ai).toEqual({ error: 'Rally’s AI credit has run out', threads: 25, detail: expect.stringContaining('credit balance') });
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
    expect(out.ai).toEqual({ error: 'the AI reading step failed', threads: 25, detail: expect.any(String) });
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

describe('reading one email without the AI', () => {
  const CWI = "From: \"Krista Lewis\" <fairfieldcateringgroup.krista.lewis@discussions.tripleseat.com>\nTo: \"Dan Baldauf\" <jodanbaldauf@gmail.com>\nDate: Wed, 18 Nov 2026 21:15:08 +0000\nSubject: The Candlewood Inn - Wedding Packages & Pricing\n\nTo: Dan Baldauf\nEach person receives their own copy, just reply.\n\nDan Baldauf\nView lead: https://portal.tripleseat.com/public_profile/requests/58375406?t=AsF0dDzI37xWNSJlOLGdZ2sANWTT8lI9s8LYCi6TWe4\n\n\nHi Dan,\n\nThank you for your interest in The Candlewood Inn, and congratulations on your engagement!\n\nWe\u2019re a lakefront wedding venue known for timeless scenery and genuine hospitality, hosting just one wedding per day so your celebration feels personal and fully supported.\n\nIt\u2019s truly a special spot - you can preview the property here: Virtual Tour of The Candlewood Inn (https://youtu.be/mXt8DkFJ_xw)\n\nTo help you get started, I\u2019ve attached our wedding package details, enhancement options, and transparent pricing. Our all-inclusive package features a 5-hour reception with exclusive use of the property, in-house catering with seasonal menus, a premium open bar, and pre-event access to the bridal suite.\n\nWe also offer optional enhancements like custom cocktail hour stations, dessert stations, and late-night bites.\n\nWe\u2019d love to show you around and learn more about your vision. Tours are available by appointment; just share a few dates that work for you!\n\nThank you again for considering us, we\u2019re honored to be part of your search.\n\nAll the Best,\n\nKrista Lewis | Sales Director\n506 Candlewood Lake Rd\nBrookfield, CT 06804\nP: 203-775-4517 ext. 202 |[www.thecandlewoodinn.com](https://www.thecandlewoodinn.com) (http://www.thecandlewoodinn.com/)\n\n\nAttachments:\n- CUSTOMIZATIONS.pdf (https://portal.tripleseat.com/public_profile/comments/404507290/file?asset_id=148804821&t=ppbsg0c9ts28pf8g51xf)\n- CWI_2027_Available_Dates___Pricing.pdf (https://portal.tripleseat.com/public_profile/comments/404507290/file?asset_id=148804822&t=ppbsg0c9ts28pf8g51xf)\nKrista Lewis\nSales Director\nkl@thecandlewoodinn.com (mailto:kl@thecandlewoodinn.com)\n203-775-4517 ext. 202\n\nCandlewood Inn\n506 Candlewood Lake Rd\nBrookfield, CT 06804\n(203) 775-4517\nPlease keep this when replying: [TS/ppbsg0c9ts28pf8g51xf]\n";
  it('gets the venue a listing-site relay email is from, out of its subject and signature', () => {
    expect(basicEmailVenue(CWI, { today: '2026-11-18', ownEmail: 'jodanbaldauf@gmail.com' })).toMatchObject({
      name: 'The Candlewood Inn', contactName: 'Krista Lewis', email: 'kl@thecandlewoodinn.com', phone: '203-775-4517 ext. 202',
      website: 'https://thecandlewoodinn.com', location: '506 Candlewood Lake Rd, Brookfield, CT 06804',
      allInclusive: 'Yes', status: 'Replied', nextStep: 'Schedule a tour', lastContactDate: '2026-11-18', price: '',
    });
  });
  it('picks up amounts, a name from the opening line, and the couple’s own email as Inquired', () => {
    const v = basicEmailVenue('Jane <jane@gmail.com>\n\nThanks for your interest in Oheka Castle! Saturdays are $25,000 minimum and dinner is $185 per person. We can accommodate up to 250 guests.', { today: '2026-11-18' });
    expect(v).toMatchObject({ name: 'Oheka Castle', email: 'jane@gmail.com', website: '', price: '$25,000 minimum, $185 per person', capacity: '250', status: 'Quote received', lastContactDate: '2026-11-18' });
    expect(basicEmailVenue('From: jo@gmail.com\nTo: events@pridwin.com\nSubject: Wedding inquiry\n\nHi!', { ownEmail: 'jo@gmail.com' })).toMatchObject({ name: 'Pridwin', email: 'events@pridwin.com', status: 'Inquired', contactName: '' });
  });
});

describe('aiFailureDetail', () => {
  it('says what Anthropic said, the request, and which key was sent', async () => {
    const { aiFailureDetail } = await import('./weddingVenueScan.js');
    const body = { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' }, request_id: 'req_011abc' };
    const err = Anthropic.APIError.generate(400, body, undefined, new Headers({ 'request-id': 'req_011abc' }));
    expect(aiFailureDetail(err, { ANTHROPIC_API_KEY: 'sk-ant-api03-xxxxWXYZ' }))
      .toBe('400 · Your credit balance is too low to access the Anthropic API. · request req_011abc · key …WXYZ');
    expect(aiFailureDetail(new Error('boom'), {})).toBe('boom · no ANTHROPIC_API_KEY on the server');
  });
});
