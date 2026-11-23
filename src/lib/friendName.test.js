import { describe, it, expect } from 'vitest';
import { joinName, splitName, namePartsOf } from './friendName';

describe('joinName', () => {
  it('joins the parts that are there', () => {
    expect(joinName({ firstName: 'Mary', middleName: 'Ann', lastName: 'Smith' })).toBe('Mary Ann Smith');
    expect(joinName({ firstName: ' Mary ', middleName: '', lastName: 'Smith' })).toBe('Mary Smith');
    expect(joinName({ firstName: '', middleName: '', lastName: 'Smith' })).toBe('Smith');
  });
  it('is empty with nothing to join', () => {
    expect(joinName({ firstName: ' ', middleName: '', lastName: '' })).toBe('');
    expect(joinName()).toBe('');
  });
});

describe('splitName', () => {
  it('takes the first and last words, and the middle from between', () => {
    expect(splitName('Mary Smith')).toEqual({ firstName: 'Mary', middleName: '', lastName: 'Smith' });
    expect(splitName('Mary Ann Smith')).toEqual({ firstName: 'Mary', middleName: 'Ann', lastName: 'Smith' });
    expect(splitName('Mary Ann Lee Smith')).toEqual({ firstName: 'Mary', middleName: 'Ann Lee', lastName: 'Smith' });
  });
  it('treats one word as a first name', () => {
    expect(splitName('Mom')).toEqual({ firstName: 'Mom', middleName: '', lastName: '' });
  });
  it('tolerates nothing', () => {
    expect(splitName('')).toEqual({ firstName: '', middleName: '', lastName: '' });
    expect(splitName(undefined)).toEqual({ firstName: '', middleName: '', lastName: '' });
  });
  it('always joins back to the same name', () => {
    for (const n of ['Mom', 'Mary Smith', 'Dr. John  Q. Public Jr.', 'Will Pratt-Stephen', "Bill O'Neill"]) {
      expect(joinName(splitName(n))).toBe(n.trim().replace(/\s+/g, ' '));
    }
  });
});

describe('namePartsOf', () => {
  it('works the parts out for a contact that has none', () => {
    expect(namePartsOf({ name: 'Mary Ann Smith' })).toEqual({ firstName: 'Mary', middleName: 'Ann', lastName: 'Smith' });
  });
  it('keeps stored parts that spell the name', () => {
    expect(namePartsOf({ name: 'Mary Ann Smith', firstName: 'Mary Ann', middleName: '', lastName: 'Smith' }))
      .toEqual({ firstName: 'Mary Ann', middleName: '', lastName: 'Smith' });
  });
  it('drops stored parts once the name was changed somewhere else', () => {
    expect(namePartsOf({ name: 'Mary Jones', firstName: 'Mary', middleName: '', lastName: 'Smith' }))
      .toEqual({ firstName: 'Mary', middleName: '', lastName: 'Jones' });
  });
  it('uses stored parts when there is no name at all', () => {
    expect(namePartsOf({ firstName: 'Mary', lastName: 'Smith' })).toEqual({ firstName: 'Mary', middleName: '', lastName: 'Smith' });
  });
  it('tolerates a missing friend', () => {
    expect(namePartsOf(undefined)).toEqual({ firstName: '', middleName: '', lastName: '' });
  });
});
