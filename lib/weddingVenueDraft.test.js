/* global Buffer */
import { describe, it, expect } from 'vitest';
import { buildRawEmail, bodyHtml } from './weddingVenueDraft.js';

const decode = (raw) => Buffer.from(raw, 'base64url').toString('utf8');
const parts = (msg) => {
  const boundary = msg.match(/boundary="([^"]+)"/)[1];
  return msg.split(`--${boundary}`).slice(1, -1).map((p) => {
    const [head, b64] = p.split('\r\n\r\n');
    return { head, text: Buffer.from(b64.replace(/\s+/g, ''), 'base64').toString('utf8') };
  });
};

describe('buildRawEmail', () => {
  const body = 'Hi Emily,\n\nWe are very interested in The Atlantic Inn for our wedding and wanted to share the details so you can put a quote together.\n• Guests: 200 <maybe> & more';
  const msg = decode(buildRawEmail({ to: 'a@b.com', subject: 'Wedding inquiry — Oct', body, inReplyTo: '<x@y>' }));

  it('keeps the headers', () => {
    expect(msg).toMatch(/^To: a@b\.com\r\n/);
    expect(msg).toContain('Subject: =?UTF-8?B?');
    expect(msg).toContain('In-Reply-To: <x@y>');
    expect(msg).toContain('Content-Type: multipart/alternative;');
  });

  it('sends plain and HTML alternatives with the same words', () => {
    const [plain, html] = parts(msg);
    expect(plain.head).toContain('text/plain');
    expect(plain.text).toBe(body.replace(/\n/g, '\r\n'));
    expect(html.head).toContain('text/html');
    expect(html.text).toBe(bodyHtml(body));
  });

  it('HTML keeps line breaks, escapes markup, and does not hard-wrap', () => {
    const h = bodyHtml(body);
    expect(h).toContain('Hi Emily,<br>\n<br>\nWe are very interested in The Atlantic Inn for our wedding and wanted to share the details so you can put a quote together.<br>');
    expect(h).toContain('200 &lt;maybe&gt; &amp; more');
  });
});
