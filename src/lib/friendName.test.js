import { describe, it, expect } from 'vitest';
import { joinName, splitName, namePartsOf, nameWithoutMiddle, memberRenames } from './friendName';

describe('joinName', () => {
  it('is the first and last name, never the middle', () => {
    expect(joinName({ firstName: 'Mary', middleName: 'Ann', lastName: 'Smith' })).toBe('Mary Smith');
    expect(joinName({ firstName: ' Mary ', middleName: '', lastName: 'Smith' })).toBe('Mary Smith');
    expect(joinName({ firstName: '', middleName: 'Ann', lastName: 'Smith' })).toBe('Smith');
  });
  it('is empty with no first or last name', () => {
    expect(joinName({ firstName: ' ', middleName: 'Ann', lastName: '' })).toBe('');
    expect(joinName()).toBe('');
  });
});

describe('splitName', () => {
  it('takes the last word as the last name and the rest as the first', () => {
    expect(splitName('Mary Smith')).toEqual({ firstName: 'Mary', middleName: '', lastName: 'Smith' });
    expect(splitName('Mary Ann Smith')).toEqual({ firstName: 'Mary Ann', middleName: '', lastName: 'Smith' });
  });
  it('treats one word as a first name', () => {
    expect(splitName('Mom')).toEqual({ firstName: 'Mom', middleName: '', lastName: '' });
  });
  it('tolerates nothing', () => {
    expect(splitName('')).toEqual({ firstName: '', middleName: '', lastName: '' });
    expect(splitName(undefined)).toEqual({ firstName: '', middleName: '', lastName: '' });
  });
  it('always joins back to the same name', () => {
    for (const n of ['Mom', 'Mary Smith', 'Mary Ann Smith', 'Dr. John  Q. Public Jr.', 'Will Pratt-Stephen', "Bill O'Neill"]) {
      expect(joinName(splitName(n))).toBe(n.trim().replace(/\s+/g, ' '));
    }
  });
});

describe('namePartsOf', () => {
  it('works the parts out for a contact that has none, with no middle name', () => {
    expect(namePartsOf({ name: 'Mary Ann Smith' })).toEqual({ firstName: 'Mary Ann', middleName: '', lastName: 'Smith' });
  });
  it('keeps stored parts, middle name included, while first and last spell the name', () => {
    expect(namePartsOf({ name: 'Mary Smith', firstName: 'Mary', middleName: 'Ann', lastName: 'Smith' }))
      .toEqual({ firstName: 'Mary', middleName: 'Ann', lastName: 'Smith' });
  });
  it('keeps them for a name saved with the middle name in it', () => {
    expect(namePartsOf({ name: 'Mary Ann Smith', firstName: 'Mary', middleName: 'Ann', lastName: 'Smith' }))
      .toEqual({ firstName: 'Mary', middleName: 'Ann', lastName: 'Smith' });
  });
  it('drops stored parts once the name was changed somewhere else', () => {
    expect(namePartsOf({ name: 'Mary Jones', firstName: 'Mary', middleName: 'Ann', lastName: 'Smith' }))
      .toEqual({ firstName: 'Mary', middleName: '', lastName: 'Jones' });
  });
  it('uses stored parts when there is no name at all', () => {
    expect(namePartsOf({ firstName: 'Mary', lastName: 'Smith' })).toEqual({ firstName: 'Mary', middleName: '', lastName: 'Smith' });
  });
  it('tolerates a missing friend', () => {
    expect(namePartsOf(undefined)).toEqual({ firstName: '', middleName: '', lastName: '' });
  });
});

describe('nameWithoutMiddle', () => {
  it('takes a stored middle name out of the name', () => {
    expect(nameWithoutMiddle({ name: 'Mary Ann Smith', firstName: 'Mary', middleName: 'Ann', lastName: 'Smith' })).toBe('Mary Smith');
    expect(nameWithoutMiddle({ name: 'Mary  Ann Smith ', firstName: 'Mary', middleName: 'Ann', lastName: 'Smith' })).toBe('Mary Smith');
  });
  it('leaves alone a name that is already without it', () => {
    expect(nameWithoutMiddle({ name: 'Mary Smith', firstName: 'Mary', middleName: 'Ann', lastName: 'Smith' })).toBeNull();
  });
  it('leaves alone a three-word name with no stored middle name', () => {
    expect(nameWithoutMiddle({ name: 'Mary Ann Smith' })).toBeNull();
    expect(nameWithoutMiddle({ name: 'Mary Ann Smith', firstName: 'Mary Ann', middleName: '', lastName: 'Smith' })).toBeNull();
  });
  it('leaves alone a name the stored parts no longer spell', () => {
    expect(nameWithoutMiddle({ name: 'Mary Ann Jones', firstName: 'Mary', middleName: 'Ann', lastName: 'Smith' })).toBeNull();
  });
  it('never leaves a contact nameless', () => {
    expect(nameWithoutMiddle({ name: 'Ann', firstName: '', middleName: 'Ann', lastName: '' })).toBeNull();
    expect(nameWithoutMiddle(undefined)).toBeNull();
  });
});

describe('memberRenames', () => {
  const members = {
    a: { name: 'Mary Ann Smith', email: 'm@x.com' },
    b: { name: 'mary ann  smith' },
    c: { name: 'Mary Jones' },
    d: 'legacy',
  };
  it('renames guests whose name is exactly the old one', () => {
    expect(memberRenames(members, [{ from: 'Mary Ann Smith', to: 'Mary Smith' }]))
      .toEqual({ 'members.a.name': 'Mary Smith', 'members.b.name': 'Mary Smith' });
  });
  it('touches nobody else, and tolerates no members', () => {
    expect(memberRenames(members, [{ from: 'Bob Lee Brown', to: 'Bob Brown' }])).toEqual({});
    expect(memberRenames(undefined, [{ from: 'A B C', to: 'A C' }])).toEqual({});
  });
});
