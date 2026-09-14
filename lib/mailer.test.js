// The one-email sender behind the wedding digest: Gmail when an App Password is
// set (it can mail anyone), Resend otherwise.
import { describe, it, expect, vi, afterEach } from 'vitest';

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));

const { sendOne, gmailConfigured, mailConfigured } = await import('./mailer.js');

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

const msg = { to: 'jo@x.com', subject: 'S', html: '<p>h</p>', fromName: 'Rally Wedding' };

describe('sendOne', () => {
  it('goes through Gmail when an App Password is configured, and never touches Resend', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    sendMail.mockResolvedValue({ messageId: '1' });
    const env = { GMAIL_USER: 'dan@gmail.com', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop', RESEND_API_KEY: 'k' };
    const r = await sendOne(msg, env);
    expect(r).toEqual({ ok: true, via: 'gmail' });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.gmail.com', auth: { user: 'dan@gmail.com', pass: 'abcdefghijklmnop' },
    }));
    expect(sendMail).toHaveBeenCalledWith({ from: 'Rally Wedding <dan@gmail.com>', to: 'jo@x.com', subject: 'S', html: '<p>h</p>' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports a Gmail refusal instead of throwing', async () => {
    sendMail.mockRejectedValue(new Error('Invalid login'));
    const r = await sendOne(msg, { GMAIL_USER: 'dan@gmail.com', GMAIL_APP_PASSWORD: 'x' });
    expect(r).toEqual({ ok: false, via: 'gmail', error: 'Invalid login' });
  });

  it('falls back to Resend without Gmail, using the configured sender', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchSpy);
    const r = await sendOne(msg, { RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'wed@mail.example.com' });
    expect(r).toEqual({ ok: true, via: 'resend' });
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toMatchObject({ from: 'Rally Wedding <wed@mail.example.com>', to: ['jo@x.com'] });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('says so when nothing is configured', async () => {
    expect(await sendOne(msg, {})).toMatchObject({ ok: false, via: 'none' });
    expect(gmailConfigured({ GMAIL_USER: 'a' })).toBe(false);
    expect(mailConfigured({ GMAIL_USER: 'a', GMAIL_APP_PASSWORD: 'b' })).toBe(true);
    expect(mailConfigured({})).toBe(false);
  });
});
