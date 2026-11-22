import { describe, it, expect } from 'vitest';
import { upcomingBirthdays, dayInZone } from './birthdayDigest';

const today = new Date(2026, 10, 22); // Sun Nov 22 2026

describe('upcomingBirthdays', () => {
  it('keeps opted-in friends inside three weeks, soonest first, with gift ideas', () => {
    const got = upcomingBirthdays([
      { id: 'a', name: 'Edge In', birthday: '12-13', birthdayEmail: true, giftIdeas: [' Tea ', ''] },
      { id: 'b', name: 'Edge Out', birthday: '12-14', birthdayEmail: true },
      { id: 'c', name: 'Not Opted', birthday: '11-25' },
      { id: 'd', name: 'Today', birthday: '11-22', birthdayEmail: true },
      { id: 'e', name: 'Yesterday', birthday: '11-21', birthdayEmail: true },
      { id: 'f', name: 'No Date', birthdayEmail: true },
      { id: 'g', name: 'Dob Only', dob: '1990-11-30', birthdayEmail: true },
      null,
    ], today);
    expect(got.map((b) => [b.name, b.daysUntil])).toEqual([['Today', 0], ['Dob Only', 8], ['Edge In', 21]]);
    expect(got[2].giftIdeas).toEqual(['Tea']);
    expect(got[1].turning).toBe(36);
    expect(got[0].turning).toBeNull();
    expect(got[2].date).toEqual(new Date(2026, 11, 13));
  });

  it('crosses the new year and ages by the year the birthday lands in', () => {
    const [b] = upcomingBirthdays([{ id: 'x', name: 'Jan', birthday: '01-03', dob: '2000-01-03', birthdayEmail: true }], new Date(2026, 11, 20));
    expect(b.daysUntil).toBe(14);
    expect(b.turning).toBe(27);
  });
});

describe('dayInZone', () => {
  it("uses the reader's calendar day, not UTC's", () => {
    // 02:00 UTC on the 23rd is still the 22nd in New York.
    const d = dayInZone(new Date('2026-11-23T02:00:00Z'));
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 10, 22]);
  });
});
