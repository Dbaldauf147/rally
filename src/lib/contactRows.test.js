import { describe, it, expect } from 'vitest';
import { fromNativeContact, fromPickerContact, hasSomething } from './contactRows';

// Payloads here are shaped like the real ones: @capacitor-community/contacts
// returns nested optional fields, the Contact Picker returns arrays for
// everything. Neither can be exercised on a dev machine, so this is the only
// place the mapping is checked before it ships to a phone.

describe('fromNativeContact', () => {
  it('reads a plain contact', () => {
    const c = fromNativeContact({
      name: { display: 'John Smith' },
      emails: [{ type: 'home', address: 'john@email.com' }],
      phones: [{ type: 'mobile', number: '555-1234' }],
    });
    expect(c).toMatchObject({ Name: 'John Smith', Email: 'john@email.com', Phone: '555-1234' });
  });

  it('builds a name from the parts when display is absent', () => {
    const c = fromNativeContact({ name: { given: 'John', middle: 'Q', family: 'Smith' } });
    expect(c.Name).toBe('John Q Smith');
  });

  it('skips the missing parts rather than leaving gaps in the name', () => {
    const c = fromNativeContact({ name: { given: 'John', middle: null, family: 'Smith' } });
    expect(c.Name).toBe('John Smith');
  });

  it('prefers display over the parts', () => {
    const c = fromNativeContact({ name: { display: 'Johnny Smith', given: 'John', family: 'Smith' } });
    expect(c.Name).toBe('Johnny Smith');
  });

  it('picks the mobile number over a landline regardless of order', () => {
    const c = fromNativeContact({
      phones: [{ type: 'home', number: '555-0000' }, { type: 'mobile', number: '555-9999' }],
    });
    expect(c.Phone).toBe('555-9999');
  });

  it('recognises an iPhone number typed as a custom label', () => {
    const c = fromNativeContact({
      phones: [{ type: 'home', number: '555-0000' }, { type: 'custom', label: 'iPhone', number: '555-9999' }],
    });
    expect(c.Phone).toBe('555-9999');
  });

  it('falls back to the only number when none is a mobile', () => {
    const c = fromNativeContact({ phones: [{ type: 'home', number: '555-0000' }] });
    expect(c.Phone).toBe('555-0000');
  });

  it('ignores a phone entry with no number', () => {
    const c = fromNativeContact({ phones: [{ type: 'mobile', number: null }, { type: 'home', number: '555-0000' }] });
    expect(c.Phone).toBe('555-0000');
  });

  it('separates work email from personal', () => {
    const c = fromNativeContact({
      emails: [{ type: 'work', address: 'a@acme.com' }, { type: 'home', address: 'a@gmail.com' }],
    });
    expect(c.Email).toBe('a@gmail.com');
    expect(c['Work Email']).toBe('a@acme.com');
  });

  it('reads work off a custom label too', () => {
    const c = fromNativeContact({
      emails: [{ type: 'custom', label: 'Work', address: 'a@acme.com' }, { type: 'home', address: 'a@gmail.com' }],
    });
    expect(c.Email).toBe('a@gmail.com');
    expect(c['Work Email']).toBe('a@acme.com');
  });

  it('promotes a work-only address to Email rather than dropping it', () => {
    const c = fromNativeContact({ emails: [{ type: 'work', address: 'a@acme.com' }] });
    expect(c.Email).toBe('a@acme.com');
    expect(c['Work Email']).toBeUndefined();
  });

  it('lowercases emails so the import dedupes against existing friends', () => {
    const c = fromNativeContact({ emails: [{ type: 'home', address: '  John@Email.COM ' }] });
    expect(c.Email).toBe('john@email.com');
  });

  it('reads a full birthday and a year-less one', () => {
    const full = fromNativeContact({ birthday: { month: 7, day: 30, year: 1985 } });
    expect(full).toMatchObject({ Birthday: '7/30', 'Date of Birth': '7/30/1985' });

    const noYear = fromNativeContact({ birthday: { month: 7, day: 30, year: null } });
    expect(noYear.Birthday).toBe('7/30');
    expect(noYear['Date of Birth']).toBeUndefined();
  });

  it('ignores a birthday missing the month or day', () => {
    expect(fromNativeContact({ birthday: { year: 1985 } }).Birthday).toBeUndefined();
  });

  it('joins a postal address into one line', () => {
    const c = fromNativeContact({
      postalAddresses: [{ type: 'home', street: '12 Oak St', city: 'Boston', region: 'MA', postcode: '02110', country: 'USA' }],
    });
    expect(c.Address).toBe('12 Oak St, Boston, MA 02110, USA');
  });

  it('skips an address with neither street nor city', () => {
    const c = fromNativeContact({ postalAddresses: [{ type: 'home', country: 'USA' }] });
    expect(c.Address).toBeUndefined();
  });

  it('files the company as the Group', () => {
    expect(fromNativeContact({ organization: { company: 'Acme' } }).Group).toBe('Acme');
  });

  it('survives an empty or absent payload', () => {
    expect(fromNativeContact({})).toEqual({});
    expect(fromNativeContact(undefined)).toEqual({});
  });
});

describe('fromPickerContact', () => {
  it('takes the first of each array the picker hands back', () => {
    const c = fromPickerContact({
      name: ['John Smith', 'Johnny'],
      email: ['John@Email.com'],
      tel: ['555-1234', '555-0000'],
    });
    expect(c).toEqual({ Name: 'John Smith', Email: 'john@email.com', Phone: '555-1234' });
  });

  it('skips past blank entries', () => {
    const c = fromPickerContact({ name: ['', 'Johnny'], email: [], tel: ['  '] });
    expect(c).toEqual({ Name: 'Johnny' });
  });
});

describe('hasSomething', () => {
  it('keeps a contact with only a phone number', () => {
    expect(hasSomething({ Phone: '555-1234' })).toBe(true);
  });

  it('drops one with nothing to identify a person by', () => {
    expect(hasSomething({ Group: 'Acme', Address: '12 Oak St' })).toBe(false);
  });
});
