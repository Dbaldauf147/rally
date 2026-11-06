import { describe, expect, it } from 'vitest';
import {
  autoDetectMappings,
  looksLikeHeader,
  normalizeStatus,
  parsePastedCells,
  planGuestImport,
  rowToFields,
} from './weddingGuestImport';

const ids = () => { let n = 0; return () => `new-${(n += 1)}`; };

describe('parsePastedCells', () => {
  it('splits tabs and lines and drops the trailing newline', () => {
    expect(parsePastedCells('First\tLast\r\nJane\tDoe\r\n')).toEqual([['First', 'Last'], ['Jane', 'Doe']]);
  });

  it('keeps a quoted multi-line cell (how Sheets and Excel copy it) in one cell', () => {
    const text = 'Name\tAddress\nJane Doe\t"12 Elm St\nApt 4"\nBob\t"say ""hi"""\n';
    expect(parsePastedCells(text)).toEqual([
      ['Name', 'Address'],
      ['Jane Doe', '12 Elm St\nApt 4'],
      ['Bob', 'say "hi"'],
    ]);
  });

  it('reads a stray quote as text', () => {
    expect(parsePastedCells('"Big" Jim Smith\tx')).toEqual([['"Big" Jim Smith', 'x']]);
  });

  it('keeps empty cells in place and drops blank rows', () => {
    expect(parsePastedCells('Jane\t\tjane@x.com\n\t\t\n\nBob\t\t')).toEqual([
      ['Jane', '', 'jane@x.com'],
      ['Bob', '', ''],
    ]);
  });
});

describe('autoDetectMappings', () => {
  it('maps common headers, the specific ones before the loose ones', () => {
    expect(autoDetectMappings(['Guest Name', 'E-mail', 'Cell', 'Mailing Address', 'Zip Code', 'RSVP', 'Side', 'Sub-category', 'Guest of', 'Wedding group', 'Notes']))
      .toEqual(['fullName', 'email', 'phone', 'address', 'zip', 'status', 'side', 'subcategory', 'guestOf', 'party', '']);
  });

  it('only uses a field once', () => {
    expect(autoDetectMappings(['Phone', 'Phone 2'])).toEqual(['phone', '']);
  });

  it('spots a header row', () => {
    expect(looksLikeHeader([['First', 'Last']])).toBe(true);
    expect(looksLikeHeader([['Jane', 'Doe']])).toBe(false);
  });
});

describe('rowToFields', () => {
  it('splits a full name with the last word as the surname and drops blanks', () => {
    expect(rowToFields(['Mary Ann Smith', '', ' 555 '], ['fullName', 'email', 'phone']))
      .toEqual({ firstName: 'Mary Ann', lastName: 'Smith', phone: '555' });
  });

  it('turns RSVP words into the page statuses and drops ones it can\'t read', () => {
    expect(normalizeStatus('Yes')).toBe('Confirmed');
    expect(normalizeStatus('declined')).toBe('Not coming');
    expect(normalizeStatus('Maybe')).toBe('Pending');
    expect(rowToFields(['Jane', 'probably?'], ['firstName', 'status'])).toEqual({ firstName: 'Jane' });
  });
});

describe('planGuestImport', () => {
  const existing = [
    { id: 'a', firstName: 'Jane', lastName: 'Doe', email: 'jane@x.com', phone: '', city: 'Boston' },
    { id: 'b', firstName: 'Bob', lastName: 'Ray', phone: '(555) 123-4567' },
    { id: 'c', firstName: 'Sam', lastName: 'Lee' },
    { id: 'd', firstName: 'Sam', lastName: 'Lee', email: 'sam2@x.com' },
  ];

  it('fills blanks on a guest matched by email, leaving their values alone', () => {
    const map = ['fullName', 'email', 'phone', 'city'];
    const r = planGuestImport(existing, [['Jane Doe', 'JANE@x.com', '617-555-0000', 'Cambridge']], map, { makeId: ids() });
    expect(r.added).toEqual([]);
    expect(r.updated).toHaveLength(1);
    expect(r.updated[0]).toMatchObject({ id: 'a', fields: ['phone'] });
    expect(r.contacts.find((g) => g.id === 'a')).toMatchObject({ phone: '617-555-0000', city: 'Boston', email: 'jane@x.com' });
  });

  it('overwrites matched values when asked, but never blanks one out', () => {
    const map = ['email', 'city', 'zip'];
    const r = planGuestImport(existing, [['jane@x.com', 'Cambridge', '']], map, { overwrite: true, makeId: ids() });
    expect(r.contacts.find((g) => g.id === 'a')).toMatchObject({ city: 'Cambridge', firstName: 'Jane' });
    expect(r.updated[0].fields).toEqual(['city']);
  });

  it('matches by phone digits and by unique full name', () => {
    const map = ['fullName', 'phone', 'zip'];
    const r = planGuestImport(existing, [['Robert Ray', '555.123.4567', '02139']], map, { makeId: ids() });
    expect(r.updated[0]).toMatchObject({ id: 'b', fields: ['zip'] });
    // Robert vs Bob: first name was already set, so it's kept.
    expect(r.contacts.find((g) => g.id === 'b').firstName).toBe('Bob');
  });

  it('adds rows with no match and keeps the order of the list', () => {
    const r = planGuestImport(existing, [['Ann', 'Kim', 'ann@x.com']], ['firstName', 'lastName', 'email'], { makeId: ids() });
    expect(r.added).toEqual([{ id: 'new-1', firstName: 'Ann', lastName: 'Kim', email: 'ann@x.com' }]);
    expect(r.contacts.map((g) => g.id)).toEqual(['a', 'b', 'c', 'd', 'new-1']);
  });

  it('sets aside a row whose name fits two guests instead of guessing', () => {
    const r = planGuestImport(existing, [['Sam Lee', 'Denver']], ['fullName', 'city'], { makeId: ids() });
    expect(r.ambiguous).toEqual([{ row: 0, name: 'Sam Lee' }]);
    expect(r.added).toEqual([]);
    expect(r.updated).toEqual([]);
  });

  it('still matches one of two same-named guests by email', () => {
    const r = planGuestImport(existing, [['Sam Lee', 'sam2@x.com', 'Denver']], ['fullName', 'email', 'city'], { makeId: ids() });
    expect(r.updated[0]).toMatchObject({ id: 'd', fields: ['city'] });
  });

  it('folds the same new person pasted twice into one guest', () => {
    const map = ['fullName', 'email', 'phone'];
    const r = planGuestImport(existing, [['Ann Kim', 'ann@x.com', ''], ['Ann Kim', '', '212 555 0101']], map, { makeId: ids() });
    expect(r.added).toEqual([{ id: 'new-1', firstName: 'Ann', lastName: 'Kim', email: 'ann@x.com', phone: '212 555 0101' }]);
    expect(r.updated).toEqual([]);
  });

  it('counts rows with nothing new and rows with no identity', () => {
    const r = planGuestImport(existing, [['jane@x.com', 'Boston'], ['', 'Nowhere']], ['email', 'city'], { makeId: ids() });
    expect(r.unchanged).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.contacts).toEqual(existing);
  });

  it('does not touch the list it was given', () => {
    const copy = JSON.parse(JSON.stringify(existing));
    planGuestImport(existing, [['jane@x.com', '1']], ['email', 'zip'], { makeId: ids() });
    expect(existing).toEqual(copy);
  });
});
