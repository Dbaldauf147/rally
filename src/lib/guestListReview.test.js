import { describe, it, expect } from 'vitest';
import {
  normalizeGuestListReview,
  guestListReviewYear,
  guestListReviewForSave,
  suggestedGuests,
  confirmGuestListUpdates,
} from './guestListReview';

const RULE = { freq: 'yearly', mode: 'date', month: 7, day: 4, startYear: 2024, endYear: null };
const DEL = Symbol('deleteField');

function yearly(extra = {}) {
  return { recurrence: RULE, occurrenceYear: 2027, guestListReview: { enabled: true, confirmedYear: 2026 }, ...extra };
}

describe('normalizeGuestListReview', () => {
  it('is null unless explicitly enabled', () => {
    expect(normalizeGuestListReview(null)).toBeNull();
    expect(normalizeGuestListReview({ confirmedYear: 2026 })).toBeNull();
    expect(normalizeGuestListReview({ enabled: 'yes' })).toBeNull();
  });

  it('keeps a usable year and drops a junk one', () => {
    expect(normalizeGuestListReview({ enabled: true, confirmedYear: '2026' })).toEqual({ enabled: true, confirmedYear: 2026 });
    expect(normalizeGuestListReview({ enabled: true, confirmedYear: 'soon' })).toEqual({ enabled: true, confirmedYear: null });
    expect(normalizeGuestListReview({ enabled: true })).toEqual({ enabled: true, confirmedYear: null });
  });
});

describe('guestListReviewYear', () => {
  it('is due once the event has rolled into a year not yet confirmed', () => {
    expect(guestListReviewYear(yearly())).toBe(2027);
  });

  it('is not due in the year already confirmed', () => {
    expect(guestListReviewYear(yearly({ occurrenceYear: 2026 }))).toBeNull();
    expect(guestListReviewYear(yearly({ guestListReview: { enabled: true, confirmedYear: 2027 } }))).toBeNull();
  });

  it('is due when nothing has ever been confirmed', () => {
    expect(guestListReviewYear(yearly({ guestListReview: { enabled: true } }))).toBe(2027);
  });

  it('never fires with the option off, without a yearly rule, or on a cancelled event', () => {
    expect(guestListReviewYear(yearly({ guestListReview: null }))).toBeNull();
    expect(guestListReviewYear(yearly({ guestListReview: { enabled: false, confirmedYear: 2020 } }))).toBeNull();
    expect(guestListReviewYear(yearly({ recurrence: null }))).toBeNull();
    expect(guestListReviewYear(yearly({ cancelled: true }))).toBeNull();
    expect(guestListReviewYear(yearly({ occurrenceYear: undefined }))).toBeNull();
  });
});

describe('guestListReviewForSave', () => {
  it('clears the setting when turned off', () => {
    expect(guestListReviewForSave(false, { enabled: true, confirmedYear: 2026 }, 2027)).toBeNull();
  });

  it('signs off the year in the form when first turned on', () => {
    expect(guestListReviewForSave(true, null, 2026)).toEqual({ enabled: true, confirmedYear: 2026 });
  });

  it('leaves an existing sign-off alone on later edits', () => {
    // The form shows the 2027 occurrence, but 2027 has not been confirmed yet —
    // saving an unrelated edit must not confirm it by accident.
    expect(guestListReviewForSave(true, { enabled: true, confirmedYear: 2026 }, 2027)).toEqual({ enabled: true, confirmedYear: 2026 });
  });
});

describe('suggestedGuests', () => {
  it('lists everyone but the organizer, by name', () => {
    const members = {
      me: { role: 'owner', name: 'Dan' },
      z: { name: 'Zed' },
      a: { name: 'Amy', role: 'editor' },
      dead: null,
    };
    expect(suggestedGuests(members).map(([k]) => k)).toEqual(['a', 'z']);
  });
});

describe('confirmGuestListUpdates', () => {
  const event = {
    members: {
      me: { role: 'owner', name: 'Dan', rsvp: 'yes', emailed: '2026-06-01' },
      amy: { name: 'Amy', rsvp: 'yes', emailed: '2026-06-01', foodOrder: 'steak', email: 'amy@x.com', group: 'Family' },
      bob: { name: 'Bob', rsvp: 'no', plusOneOf: 'cat' },
      cat: { name: 'Cat', rsvp: 'maybe', attendance: 'came' },
      dead: null,
    },
  };

  it('keeps the ticked guests, asks them again, and records the year', () => {
    const { updates, removed } = confirmGuestListUpdates(event, ['amy', 'bob', 'cat'], 2027, DEL);
    expect(removed).toEqual([]);
    expect(updates.guestListReview).toEqual({ enabled: true, confirmedYear: 2027 });
    expect(updates['members.amy.rsvp']).toBe('pending');
    expect(updates['members.amy.emailed']).toBe(DEL);
    expect(updates['members.amy.foodOrder']).toBe(DEL);
    expect(updates['members.cat.attendance']).toBe(DEL);
    // Who they are is untouched — only last year's answers go.
    expect(Object.keys(updates).some(k => k.startsWith('members.amy.email') && k !== 'members.amy.emailed')).toBe(false);
    expect(updates['members.amy.group']).toBeUndefined();
    expect(updates['members.amy']).toBeUndefined();
    // Bob's link to Cat survives because Cat is staying.
    expect(updates['members.bob.plusOneOf']).toBeUndefined();
  });

  it('the organizer always stays, and is going', () => {
    const { updates, removed } = confirmGuestListUpdates(event, [], 2027, DEL);
    expect(removed.sort()).toEqual(['amy', 'bob', 'cat']);
    expect(updates['members.me.rsvp']).toBe('yes');
    expect(updates['members.me.emailed']).toBe(DEL);
    expect(updates['members.me']).toBeUndefined();
  });

  it('removes unticked guests whole and unhooks anyone linked to them', () => {
    const { updates, removed } = confirmGuestListUpdates(event, ['amy', 'bob'], 2027, DEL);
    expect(removed).toEqual(['cat']);
    expect(updates['members.cat']).toBe(DEL);
    expect(updates['members.cat.rsvp']).toBeUndefined();
    expect(updates['members.bob.plusOneOf']).toBe(DEL);
    expect(updates['members.bob.rsvp']).toBe('pending');
  });

  it('does not write deletes for fields a guest never had', () => {
    const { updates } = confirmGuestListUpdates(event, ['bob', 'cat'], 2027, DEL);
    expect(updates['members.bob.emailed']).toBeUndefined();
    expect(updates['members.bob.foodOrder']).toBeUndefined();
  });

  it('copes with an event that has no members map', () => {
    expect(confirmGuestListUpdates({}, [], 2027, DEL)).toEqual({
      updates: { guestListReview: { enabled: true, confirmedYear: 2027 } },
      removed: [],
    });
  });
});
