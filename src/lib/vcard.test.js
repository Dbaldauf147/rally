import { describe, it, expect } from 'vitest';
import { parseVCards, headersFor } from './vcard';

const card = (body) => `BEGIN:VCARD\r\nVERSION:3.0\r\n${body}\r\nEND:VCARD\r\n`;

describe('parseVCards', () => {
  it('reads a plain 3.0 card', () => {
    const [c] = parseVCards(card('FN:John Smith\r\nEMAIL:john@email.com\r\nTEL:555-1234'));
    expect(c).toMatchObject({ Name: 'John Smith', Email: 'john@email.com', Phone: '555-1234' });
  });

  it('builds a name from N when FN is absent', () => {
    const [c] = parseVCards(card('N:Smith;John;Q;;'));
    expect(c.Name).toBe('John Q Smith');
  });

  it('prefers FN over N', () => {
    const [c] = parseVCards(card('N:Smith;John;;;\r\nFN:Johnny Smith'));
    expect(c.Name).toBe('Johnny Smith');
  });

  it('picks the mobile number over a landline regardless of order', () => {
    const [c] = parseVCards(card('FN:A\r\nTEL;TYPE=HOME:555-0000\r\nTEL;TYPE=CELL:555-9999'));
    expect(c.Phone).toBe('555-9999');
  });

  it('falls back to the only number when none is a mobile', () => {
    const [c] = parseVCards(card('FN:A\r\nTEL;TYPE=HOME:555-0000'));
    expect(c.Phone).toBe('555-0000');
  });

  it('separates work email from personal', () => {
    const [c] = parseVCards(card('FN:A\r\nEMAIL;TYPE=WORK:a@acme.com\r\nEMAIL;TYPE=HOME:a@gmail.com'));
    expect(c.Email).toBe('a@gmail.com');
    expect(c['Work Email']).toBe('a@acme.com');
  });

  it('promotes a work-only address to Email rather than dropping it', () => {
    const [c] = parseVCards(card('FN:A\r\nEMAIL;TYPE=WORK:a@acme.com'));
    expect(c.Email).toBe('a@acme.com');
    expect(c['Work Email']).toBeUndefined();
  });

  it('reads a full birthday and a year-less one', () => {
    const [a] = parseVCards(card('FN:A\r\nBDAY:1985-07-30'));
    expect(a).toMatchObject({ Birthday: '7/30', 'Date of Birth': '7/30/1985' });
    const [b] = parseVCards(card('FN:B\r\nBDAY:--0730'));
    expect(b.Birthday).toBe('7/30');
    expect(b['Date of Birth']).toBeUndefined();
  });

  it("treats Apple's 1604 sentinel as no year", () => {
    const [c] = parseVCards(card('FN:A\r\nBDAY;X-APPLE-OMIT-YEAR=1604:1604-07-30'));
    expect(c.Birthday).toBe('7/30');
    expect(c['Date of Birth']).toBeUndefined();
  });

  it('reads the compact 19850730 form', () => {
    const [c] = parseVCards(card('FN:A\r\nBDAY:19850730'));
    expect(c).toMatchObject({ Birthday: '7/30', 'Date of Birth': '7/30/1985' });
  });

  it('flattens a structured address', () => {
    const [c] = parseVCards(card('FN:A\r\nADR;TYPE=HOME:;;123 Main St;Denver;CO;80202;USA'));
    expect(c.Address).toBe('123 Main St, Denver, CO 80202, USA');
  });

  it('unfolds continued lines', () => {
    const [c] = parseVCards('BEGIN:VCARD\r\nFN:A Very Long\r\n  Name Here\r\nEND:VCARD');
    expect(c.Name).toBe('A Very Long Name Here');
  });

  it('decodes quoted-printable values', () => {
    const [c] = parseVCards('BEGIN:VCARD\r\nFN;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:Jos=C3=A9\r\nEND:VCARD');
    expect(c.Name).toBe('José');
  });

  it('unescapes commas and semicolons in values', () => {
    const [c] = parseVCards(card('FN:Smith\\, John\r\nNOTE:a\\;b'));
    expect(c.Name).toBe('Smith, John');
    expect(c.Note).toBe('a;b');
  });

  it('reads Apple item-group work labels', () => {
    const [c] = parseVCards(card('FN:A\r\nitem1.EMAIL:a@acme.com\r\nitem1.X-ABLabel:Work\r\nEMAIL;TYPE=HOME:a@gmail.com'));
    expect(c['Work Email']).toBe('a@acme.com');
    expect(c.Email).toBe('a@gmail.com');
  });

  it('handles bare 2.1 type shorthand', () => {
    const [c] = parseVCards(card('FN:A\r\nTEL;CELL:555-9999'));
    expect(c.Phone).toBe('555-9999');
  });

  it('reads several cards from one file', () => {
    const text = card('FN:A\r\nEMAIL:a@x.com') + card('FN:B\r\nEMAIL:b@x.com');
    expect(parseVCards(text).map(c => c.Name)).toEqual(['A', 'B']);
  });

  it('skips cards with nothing identifying and survives junk lines', () => {
    const text = card('NOTE:just a note') + card('FN:Real Person') + 'GARBAGE\r\n';
    expect(parseVCards(text).map(c => c.Name)).toEqual(['Real Person']);
  });

  it('lowercases emails so the friend doc id dedupes', () => {
    const [c] = parseVCards(card('FN:A\r\nEMAIL:John@Email.COM'));
    expect(c.Email).toBe('john@email.com');
  });

  it('takes the company as a group', () => {
    const [c] = parseVCards(card('FN:A\r\nORG:Acme Inc;Sales'));
    expect(c.Group).toBe('Acme Inc');
  });

  it('returns an empty list for empty or non-vCard input', () => {
    expect(parseVCards('')).toEqual([]);
    expect(parseVCards('hello world')).toEqual([]);
  });

  it('tolerates LF-only line endings', () => {
    const [c] = parseVCards('BEGIN:VCARD\nFN:A\nEMAIL:a@x.com\nEND:VCARD');
    expect(c).toMatchObject({ Name: 'A', Email: 'a@x.com' });
  });
});

describe('headersFor', () => {
  it('orders known columns and appends unknown ones', () => {
    const rows = [{ Name: 'A', Phone: '1', Zzz: 'x' }, { Email: 'b@x.com' }];
    expect(headersFor(rows)).toEqual(['Name', 'Email', 'Phone', 'Zzz']);
  });

  it('returns nothing for no rows', () => {
    expect(headersFor([])).toEqual([]);
  });
});
