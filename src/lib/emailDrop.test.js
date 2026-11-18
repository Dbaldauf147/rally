import { describe, it, expect } from 'vitest';
import { dropPayload, emlToText, htmlToText, parseEml } from './emailDrop.js';

const EML = [
  'From: "Jane Smith" <jane@thefoundry.com>',
  'To: jo@gmail.com',
  'Subject: =?UTF-8?Q?Re:_Wedding_inquiry_=E2=80=94_The_Foundry?=',
  'Date: Tue, 17 Nov 2026 15:42:00 -0500',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/plain; charset=UTF-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Hi Jo,=0A',
  'Our Saturday site fee is $18,000 and dinner runs $165=E2=80=93$185 per pe=',
  'rson.',
  '--b1',
  'Content-Type: text/html; charset=UTF-8',
  '',
  '<p>Hi Jo,</p>',
  '--b1--',
  '',
].join('\r\n');

describe('reading a dropped email', () => {
  it('turns HTML into lines of text', () => {
    expect(htmlToText('<div>Hi&nbsp;Jo,</div><p>Fee: <b>$18,000</b><br>Call 555&#8209;1234</p><style>p{}</style>')).toBe('Hi Jo,\nFee: $18,000\nCall 555‑1234');
  });

  it('reads a saved .eml: headers decoded, the plain-text body unwrapped', () => {
    const m = parseEml(EML);
    expect(m.subject).toBe('Re: Wedding inquiry — The Foundry');
    expect(m.from).toBe('"Jane Smith" <jane@thefoundry.com>');
    expect(m.text).toContain('$165–$185 per person.');
    expect(m.text).not.toContain('<p>');
    expect(emlToText(EML)).toMatch(/^From: "Jane Smith" <jane@thefoundry.com>\nTo: jo@gmail.com\nDate: .*\nSubject: Re: Wedding inquiry — The Foundry\n\nHi Jo,/);
  });

  it('falls back to the HTML part, and to base64 bodies', () => {
    const b64 = btoa('<p>Package: $140 per person</p>');
    const raw = 'Subject: Hi\nContent-Type: text/html\nContent-Transfer-Encoding: base64\n\n' + b64;
    expect(parseEml(raw).text).toBe('Package: $140 per person');
  });

  it('keeps an email file over the drag text, and says which files it skipped', () => {
    const p = dropPayload({ files: [{ name: 'Re Wedding.eml', type: 'message/rfc822', text: EML }, { name: 'contract.pdf', type: 'application/pdf', text: null }], plain: 'Re Wedding.eml' });
    expect(p.text).toContain('From: "Jane Smith"');
    expect(p.subject).toBe('Re: Wedding inquiry — The Foundry');
    expect(p.skipped).toEqual(['contract.pdf']);
  });

  it('keeps the fuller of the selection’s HTML and plain text', () => {
    expect(dropPayload({ html: '<div>Jane Smith &lt;jane@x.com&gt;</div><div>Fee is $5,000</div>', plain: 'Jane Smith' }).text).toBe('Jane Smith <jane@x.com>\nFee is $5,000');
    expect(dropPayload({ html: '', plain: '  Hello there  ' }).text).toBe('Hello there');
  });

  it('a dragged link is a link, not text', () => {
    const url = 'https://mail.google.com/mail/u/0/#inbox/18c2f3a9b0d1e2f3';
    expect(dropPayload({ uri: `# comment\n${url}`, plain: url })).toMatchObject({ text: '', url });
    expect(dropPayload({ plain: url })).toMatchObject({ text: '', url });
  });
});
