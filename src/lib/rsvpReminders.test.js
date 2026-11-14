import { describe, it, expect } from 'vitest';
import {
  rsvpIntervals, parseDayList, hasResponded, rsvpReminderRecipients, dueRsvpReminder, rsvpReminderSchedule,
} from './rsvpReminders';

const at = (s) => new Date(`${s}T14:00:05Z`);
const event = (extra = {}) => ({
  stage: 'finalized',
  rsvpReminders: { enabled: true, intervals: [3, 7], startedAt: '2026-11-01T14:00:00Z' },
  members: {
    dan: { role: 'owner', name: 'Dan', email: 'dan@x.com', rsvp: 'yes' },
    amy: { name: 'Amy', email: 'amy@x.com', rsvp: 'pending' },
    bob: { name: 'Bob', email: 'bob@x.com', rsvp: 'no' },
    cat: { name: 'Cat', email: '', rsvp: 'pending' },
    eve: { name: 'Eve', email: 'eve@x.com' },
    fay: { name: 'Fay', email: 'fay@x.com', attendance: 'going' },
    gus: { name: 'Gus', email: 'gus@x.com', plusOneOf: 'dan' },
    hid: { name: 'Hid', email: 'Hid@x.com' },
    amy2: { name: 'Amy again', email: 'AMY@x.com' },
  },
  hiddenFrom: ['hid@x.com'],
  ...extra,
});

describe('intervals', () => {
  it('cleans the list, and falls back to the default', () => {
    expect(rsvpIntervals({ intervals: ['7', 3, 3, 0, 'x'] })).toEqual([3, 7]);
    expect(rsvpIntervals(undefined)).toEqual([3, 7]);
    expect(parseDayList('3, 7 and 14 days')).toEqual([3, 7, 14]);
    expect(parseDayList('')).toEqual([]);
  });
});

describe('hasResponded', () => {
  it('counts an RSVP, a manual going, a vote, or a ride-along +1', () => {
    const m = event().members;
    expect(hasResponded('amy', m.amy, m)).toBe(false);
    expect(hasResponded('bob', m.bob, m)).toBe(true);
    expect(hasResponded('fay', m.fay, m)).toBe(true);
    expect(hasResponded('eve', m.eve, m, { eve: { total: 1, no: 1 } })).toBe(true);
    expect(hasResponded('eve', m.eve, m)).toBe(false);
  });
});

describe('rsvpReminderRecipients', () => {
  it('is the unanswered guests with an email, once each, never the hidden or the organizer', () => {
    const keys = rsvpReminderRecipients(event()).map(([k]) => k);
    expect(keys).toContain('amy');
    expect(keys).toContain('eve');
    for (const k of ['dan', 'bob', 'cat', 'fay', 'hid', 'amy2']) expect(keys, k).not.toContain(k);
  });

  it('drops somebody who has voted on a date', () => {
    const options = [{ votes: { eve: { vote: 'maybe' } } }];
    expect(rsvpReminderRecipients(event(), options).map(([k]) => k)).not.toContain('eve');
  });
});

describe('dueRsvpReminder', () => {
  const e = event();
  it('waits for the first interval, then sends one reminder at a time', () => {
    expect(dueRsvpReminder(e, {}, at('2026-11-03'))).toBeNull();
    expect(dueRsvpReminder(e, {}, at('2026-11-04'))).toEqual({ reminderNum: 1, totalReminders: 2 });
    expect(dueRsvpReminder(e, { rsvpRemindersSent: 1 }, at('2026-11-05'))).toBeNull();
    expect(dueRsvpReminder(e, { rsvpRemindersSent: 1 }, at('2026-11-08'))).toEqual({ reminderNum: 2, totalReminders: 2 });
    expect(dueRsvpReminder(e, { rsvpRemindersSent: 2 }, at('2026-11-20'))).toBeNull();
  });

  it('sends nothing when off, unstarted, cancelled, still voting, or after the event', () => {
    const day = at('2026-11-10');
    expect(dueRsvpReminder(event({ rsvpReminders: { enabled: false, startedAt: '2026-11-01T14:00:00Z' } }), {}, day)).toBeNull();
    expect(dueRsvpReminder(event({ rsvpReminders: { enabled: true } }), {}, day)).toBeNull();
    expect(dueRsvpReminder(event({ cancelled: true }), {}, day)).toBeNull();
    expect(dueRsvpReminder(event({ stage: 'voting' }), {}, day)).toBeNull();
    expect(dueRsvpReminder(e, {}, day, new Date('2026-11-05T12:00:00Z'))).toBeNull();
    expect(dueRsvpReminder(e, {}, day, new Date('2026-12-25T12:00:00Z'))).not.toBeNull();
  });
});

describe('rsvpReminderSchedule', () => {
  it('lists the send days from when it was switched on', () => {
    const s = rsvpReminderSchedule(event().rsvpReminders, at('2026-11-05'));
    expect(s.map((x) => [x.n, x.at.toISOString().slice(0, 10), x.past])).toEqual([[3, '2026-11-04', true], [7, '2026-11-08', false]]);
    expect(rsvpReminderSchedule(event().rsvpReminders, at('2026-11-02'))[0].past).toBe(false);
  });
});
