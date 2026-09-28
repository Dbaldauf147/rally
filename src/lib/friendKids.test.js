import { describe, it, expect } from 'vitest';
import { kidsForEditing, kidsForSaving, kidAge, kidLabel } from './friendKids';

const TODAY = new Date(2026, 8, 28); // Sep 28, 2026

describe('kidsForSaving', () => {
  it('keeps named kids, with or without a year, and drops blank rows', () => {
    expect(kidsForSaving([
      { name: ' Emma ', birthday: '3/14/2019' },
      { name: 'Liam', birthday: '9/2' },
      { name: 'Ava', birthday: '' },
      { name: '', birthday: '1/1' },
    ])).toEqual([
      { name: 'Emma', birthday: '2019-03-14' },
      { name: 'Liam', birthday: '09-02' },
      { name: 'Ava', birthday: '' },
    ]);
  });
  it('clears a date it cannot read', () => {
    expect(kidsForSaving([{ name: 'Ava', birthday: 'soon' }])).toEqual([{ name: 'Ava', birthday: '' }]);
  });
  it('tolerates a missing list', () => {
    expect(kidsForSaving(undefined)).toEqual([]);
  });
});

describe('kidsForEditing', () => {
  it('shows stored dates the way they are typed', () => {
    expect(kidsForEditing([{ name: 'Emma', birthday: '2019-03-14' }, { name: 'Liam', birthday: '09-02' }]))
      .toEqual([{ name: 'Emma', birthday: '3/14/2019' }, { name: 'Liam', birthday: '9/2' }]);
  });
  it('starts with one empty row', () => {
    expect(kidsForEditing(undefined)).toEqual([{ name: '', birthday: '' }]);
  });
});

describe('kidAge', () => {
  it('counts the birthday only once it has come round', () => {
    expect(kidAge('2019-03-14', TODAY)).toBe(7);
    expect(kidAge('2019-12-01', TODAY)).toBe(6);
    expect(kidAge('2019-09-28', TODAY)).toBe(7);
  });
  it('has no age without a year', () => {
    expect(kidAge('03-14', TODAY)).toBeNull();
  });
});

describe('kidLabel', () => {
  it('reads name, day and age', () => {
    expect(kidLabel({ name: 'Emma', birthday: '2019-03-14' }, TODAY)).toBe('Emma · 3/14 · 7');
    expect(kidLabel({ name: 'Liam', birthday: '09-02' }, TODAY)).toBe('Liam · 9/2');
    expect(kidLabel({ name: 'Ava', birthday: '' }, TODAY)).toBe('Ava');
  });
});

describe('kidsWithBirthdayToday', () => {
  it('finds the kids born on today’s date, with the age they turn', async () => {
    const { kidsWithBirthdayToday, kidBirthdayLine } = await import('./friendKids');
    const kids = [
      { name: 'Emma', birthday: '2019-09-28' },
      { name: 'Liam', birthday: '09-28' },
      { name: 'Ava', birthday: '2020-03-14' },
      { name: '', birthday: '09-28' },
    ];
    const out = kidsWithBirthdayToday(kids, TODAY);
    expect(out).toEqual([{ name: 'Emma', turns: 7 }, { name: 'Liam', turns: null }]);
    expect(out.map(kidBirthdayLine)).toEqual(['Emma turns 7 today', "Liam's birthday is today"]);
    expect(kidsWithBirthdayToday(undefined, TODAY)).toEqual([]);
  });
});
