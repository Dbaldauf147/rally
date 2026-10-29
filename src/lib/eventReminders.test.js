import { describe, it, expect } from 'vitest';
import {
  dayKey, daysUntil, reminderDays, isComingOrMaybe, eventReminderRecipients,
  dueEventReminder, eventReminderSchedule, eventRemindersSentFor,
} from './eventReminders';

// Nov 14, 2026 at 6pm Eastern (23:00 UTC).
const EVENT_AT = '2026-11-14T23:00:00Z';
const at = (iso) => new Date(iso);
// The daily check runs at 14:00 UTC — 9am Eastern in November.
const checkOn = (ymd) => at(`${ymd}T14:00:05Z`);
const finalized = (extra = {}) => ({
  stage: 'finalized', date: EVENT_AT, eventReminders: { enabled: true, daysBefore: [7, 1] }, ...extra,
});

describe('days', () => {
  it('counts calendar days in Eastern time, not UTC', () => {
    // 8pm Eastern on the 14th is already the 15th in UTC.
    expect(dayKey('2026-11-15T01:00:00Z')).toBe('2026-11-14');
    expect(daysUntil('2026-11-15T01:00:00Z', checkOn('2026-11-13'))).toBe(1);
    expect(daysUntil(EVENT_AT, checkOn('2026-11-14'))).toBe(0);
    expect(daysUntil(EVENT_AT, checkOn('2026-11-15'))).toBe(-1);
  });

  it('reads a Firestore timestamp', () => {
    expect(dayKey({ toDate: () => at(EVENT_AT) })).toBe('2026-11-14');
  });

  it('has no answer without a date', () => {
    expect(daysUntil(null, checkOn('2026-11-13'))).toBe(null);
  });

  it('cleans up the reminder days', () => {
    expect(reminderDays({ daysBefore: [1, 7, 7, '3', '', -2] })).toEqual([7, 3, 1]);
    expect(reminderDays({})).toEqual([7, 1]);
  });
});

describe('isComingOrMaybe', () => {
  const stats = { y: { total: 1, yes: 1, maybe: 0, no: 0 }, m: { total: 1, yes: 0, maybe: 1, no: 0 }, n: { total: 1, yes: 0, maybe: 0, no: 1 } };

  it('counts yes and maybe votes, not no', () => {
    expect(isComingOrMaybe('y', {}, {}, stats)).toBe(true);
    expect(isComingOrMaybe('m', {}, {}, stats)).toBe(true);
    expect(isComingOrMaybe('n', {}, {}, stats)).toBe(false);
    expect(isComingOrMaybe('none', {}, {}, stats)).toBe(false);
  });

  it('lets a manual Going / Not going win, then the RSVP', () => {
    expect(isComingOrMaybe('n', { attendance: 'going' }, {}, stats)).toBe(true);
    expect(isComingOrMaybe('y', { attendance: 'notgoing' }, {}, stats)).toBe(false);
    expect(isComingOrMaybe('none', { rsvp: 'maybe' }, {}, stats)).toBe(true);
    expect(isComingOrMaybe('y', { rsvp: 'no' }, {}, stats)).toBe(false);
  });
});

describe('eventReminderRecipients', () => {
  const options = [{ votes: { y: { vote: 'yes' }, m: { vote: 'maybe' }, n: { vote: 'no' }, dup: { vote: 'yes' } } }];
  const event = finalized({
    hiddenFrom: ['Secret@x.com'],
    members: {
      own: { name: 'Dan', email: 'd@x.com', role: 'owner', rsvp: 'yes' },
      y: { name: 'Y', email: 'y@x.com' },
      m: { name: 'M', email: 'm@x.com' },
      n: { name: 'N', email: 'n@x.com' },
      none: { name: 'None', email: 'none@x.com' },
      nomail: { name: 'No email', rsvp: 'yes' },
      secret: { name: 'Secret', email: 'secret@x.com', rsvp: 'yes' },
      dup: { name: 'Y again', email: 'Y@x.com' },
      plus: { name: 'Plus one', email: 'p@x.com', plusOneOf: 'y' },
    },
  });

  it('is the yeses and maybes with an email, once each, not the organizer', () => {
    expect(eventReminderRecipients(event, options).map(([uid]) => uid)).toEqual(['y', 'm', 'plus']);
  });
});

describe('dueEventReminder', () => {
  const member = (log) => ({ email: 'y@x.com', eventReminderLog: log });

  it('sends the 7-day reminder a week out, and nothing before', () => {
    expect(dueEventReminder(finalized(), member(), checkOn('2026-11-06'))).toBe(null);
    expect(dueEventReminder(finalized(), member(), checkOn('2026-11-07')))
      .toEqual({ daysAway: 7, logKeys: ['2026-11-14:7'] });
  });

  it('sends the 1-day reminder after the 7-day one, and each only once', () => {
    const sent7 = member(['2026-11-14:7']);
    expect(dueEventReminder(finalized(), sent7, checkOn('2026-11-10'))).toBe(null);
    expect(dueEventReminder(finalized(), sent7, checkOn('2026-11-13')))
      .toEqual({ daysAway: 1, logKeys: ['2026-11-14:1'] });
    expect(dueEventReminder(finalized(), member(['2026-11-14:7', '2026-11-14:1']), checkOn('2026-11-14'))).toBe(null);
  });

  it('switched on late, sends one email that covers what it missed', () => {
    expect(dueEventReminder(finalized(), member(), checkOn('2026-11-13')))
      .toEqual({ daysAway: 1, logKeys: ['2026-11-14:7', '2026-11-14:1'] });
  });

  it('starts over when the event moves to another day', () => {
    const sentForOldDate = member(['2026-11-07:7', '2026-11-07:1']);
    expect(dueEventReminder(finalized(), sentForOldDate, checkOn('2026-11-07')))
      .toEqual({ daysAway: 7, logKeys: ['2026-11-14:7'] });
  });

  it('stays quiet when off, cancelled, still voting, or over', () => {
    const now = checkOn('2026-11-13');
    expect(dueEventReminder(finalized({ eventReminders: { enabled: false, daysBefore: [1] } }), member(), now)).toBe(null);
    expect(dueEventReminder(finalized({ cancelled: true }), member(), now)).toBe(null);
    expect(dueEventReminder(finalized({ stage: 'voting' }), member(), now)).toBe(null);
    expect(dueEventReminder(finalized(), member(), checkOn('2026-11-15'))).toBe(null);
  });
});

describe('eventReminderSchedule', () => {
  it('gives the send days, marking ones already gone by', () => {
    expect(eventReminderSchedule(finalized(), checkOn('2026-11-10'))).toEqual([
      { n: 7, day: '2026-11-07', past: true },
      { n: 1, day: '2026-11-13', past: false },
    ]);
  });
});

describe('eventRemindersSentFor', () => {
  it('counts only sends for the current date', () => {
    expect(eventRemindersSentFor(finalized(), { eventReminderLog: ['2026-11-14:7', '2026-11-07:1'] })).toBe(1);
    expect(eventRemindersSentFor(finalized(), {})).toBe(0);
  });
});
