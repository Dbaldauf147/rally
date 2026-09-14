// When the weekly wedding email goes, and what happens when one address on the
// list is refused. The Sunday of 2026-09-13 went unsent: a second address had
// been added, Resend refused it, and the one combined message took the first
// address down with it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isDueNow, sendDigestForUser } from '../api/wedding-digest.js';

const sunday = (utc) => new Date(`2026-${utc}Z`);

describe('isDueNow', () => {
  const cfg = { enabled: true, sendWeekday: 0 };

  it('sends at 8 AM Eastern in summer, from the 12:00 UTC run', () => {
    expect(isDueNow(cfg, sunday('09-13T12:20:00'))).toBe(true); // 8:20 EDT
    expect(isDueNow(cfg, sunday('09-13T11:59:00'))).toBe(false); // 7:59 EDT
  });

  it('waits for the 13:00 UTC run in winter, when 12:00 is 7 AM', () => {
    expect(isDueNow(cfg, sunday('12-06T12:30:00'))).toBe(false); // 7:30 EST
    expect(isDueNow(cfg, sunday('12-06T13:10:00'))).toBe(true); // 8:10 EST
  });

  it('lets the later run retry a morning that did not send, and only once', () => {
    expect(isDueNow(cfg, sunday('09-13T13:05:00'))).toBe(true);
    expect(isDueNow({ ...cfg, lastSentDate: '2026-09-13' }, sunday('09-13T13:05:00'))).toBe(false);
  });

  it('sends nothing on the wrong day or when switched off', () => {
    expect(isDueNow(cfg, new Date('2026-09-14T12:30:00Z'))).toBe(false); // Monday
    expect(isDueNow({ ...cfg, enabled: false }, sunday('09-13T12:30:00'))).toBe(false);
  });
});

describe('sendDigestForUser', () => {
  afterEach(() => vi.unstubAllGlobals());

  const CHECK = { phases: [{ id: 'p', title: 'Now', tasks: [{ id: 't', text: 'Book the venue' }] }], done: {} };
  const user = { email: 'dan@x.com', weddingChecklist: CHECK, weddingDigest: { emails: ['dan@x.com', 'jo@x.com'] } };

  it('sends each address its own email, so one refusal does not stop the other', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body.to);
      return body.to[0] === 'jo@x.com'
        ? { ok: false, status: 403, json: async () => ({ message: 'You can only send testing emails to your own email address' }) }
        : { ok: true, status: 200, json: async () => ({ id: '1' }) };
    }));
    const result = await sendDigestForUser('uid', user, new Date('2026-09-13T12:30:00Z'), null, { RESEND_API_KEY: 'key' });
    expect(calls).toEqual([['dan@x.com'], ['jo@x.com']]);
    expect(result.success).toBe(true);
    expect(result.sentTo).toEqual(['dan@x.com']);
    expect(result.failed).toEqual([{ email: 'jo@x.com', error: 'You can only send testing emails to your own email address' }]);
  });

  it('is a failure, naming each address, when nobody gets it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const result = await sendDigestForUser('uid', user, new Date('2026-09-13T12:30:00Z'), null, { RESEND_API_KEY: 'key' });
    expect(result.success).toBe(false);
    expect(result.failed.map((f) => f.email)).toEqual(['dan@x.com', 'jo@x.com']);
    expect(result.error).toContain('jo@x.com: HTTP 500');
  });
});
