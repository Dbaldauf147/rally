import { describe, it, expect } from 'vitest';
import { readyToStartReminders, nextReminder, reminderSendDates } from './autoReminders';

const armed = (extra = {}) => ({ autoReminders: { enabled: true, intervals: [3, 5, 7], startedAt: '' }, ...extra });
const ready = { openOptionCount: 2, emailableCount: 1 };

describe('readyToStartReminders', () => {
  it('starts an armed schedule once the poll has dates and someone to email', () => {
    expect(readyToStartReminders(armed(), ready)).toBe(true);
  });

  it('waits while the poll has no open dates', () => {
    expect(readyToStartReminders(armed(), { openOptionCount: 0, emailableCount: 3 })).toBe(false);
  });

  it('waits while nobody on the event has an email', () => {
    expect(readyToStartReminders(armed(), { openOptionCount: 2, emailableCount: 0 })).toBe(false);
  });

  it('waits for a poll-series round until its poll has gone out', () => {
    expect(readyToStartReminders(armed({ pollSendDate: '2026-11-01' }), ready)).toBe(false);
    expect(readyToStartReminders(armed({ pollSendDate: '2026-11-01', pollSentAt: '2026-11-01T11:00:00Z' }), ready)).toBe(true);
  });

  it('leaves a running or switched-off schedule alone', () => {
    expect(readyToStartReminders({ autoReminders: { enabled: true, intervals: [3], startedAt: '2026-10-01T00:00:00Z' } }, ready)).toBe(false);
    expect(readyToStartReminders({ autoReminders: { enabled: false, intervals: [3], startedAt: '' } }, ready)).toBe(false);
    expect(readyToStartReminders({}, ready)).toBe(false);
  });
});

describe('nextReminder', () => {
  const opts = (votes = {}) => [{ votes }];
  const event = (extra = {}) => ({
    autoReminders: { enabled: true, intervals: [3, 5, 7], startedAt: '2026-10-10T14:00:05Z' },
    members: {
      own: { name: 'Dan', email: 'd@x.com', role: 'owner' },
      a: { name: 'A', email: 'a@x.com' },
      b: { name: 'B', email: 'b@x.com', autoRemindersSent: 1 },
      c: { name: 'C', email: 'c@x.com' },
      nomail: { name: 'No email' },
      skip: { name: 'Skip', email: 's@x.com', skipVote: true },
    },
    ...extra,
  });

  it('is off when not switched on, armed before the clock starts', () => {
    expect(nextReminder({}, {}).state).toBe('off');
    expect(nextReminder({ autoReminders: { enabled: false, intervals: [3] } }).state).toBe('off');
    expect(nextReminder({ autoReminders: { enabled: true, intervals: [3], startedAt: '' } })).toEqual({ state: 'armed', total: 1 });
  });

  it('gives the next daily check that sends, and who it goes to', () => {
    // Started Oct 10; first reminders are due on day 3 → the Oct 13 check.
    const r = nextReminder(event(), { openOptions: opts({ own: { vote: 'yes' }, c: { vote: 'yes' } }), now: new Date('2026-10-11T09:00:00Z') });
    expect(r).toEqual({ state: 'scheduled', at: new Date('2026-10-13T14:00:00Z'), count: 1, reminder: 1, total: 3 });
  });

  it('drops the reminder number when people are at different points', () => {
    const e = event();
    e.members.b.autoRemindersSent = 0;
    e.members.a.autoRemindersSent = 1;
    e.autoReminders.intervals = [3, 3, 7];
    const r = nextReminder(e, { openOptions: opts({ own: { vote: 'yes' } }), now: new Date('2026-10-11T09:00:00Z') });
    expect(r).toMatchObject({ count: 3, reminder: null });
  });

  it('counts a reminder due now as going out at today’s check', () => {
    const r = nextReminder(event(), { openOptions: opts(), now: new Date('2026-10-18T14:00:30Z') });
    expect(r.at).toEqual(new Date('2026-10-18T14:00:00Z'));
    // Past that hour, the next chance is tomorrow.
    expect(nextReminder(event(), { openOptions: opts(), now: new Date('2026-10-18T16:00:00Z') }).at)
      .toEqual(new Date('2026-10-19T14:00:00Z'));
  });

  it('is done once everyone has voted or run out of reminders', () => {
    const e = event();
    e.members.a.autoRemindersSent = 3;
    const r = nextReminder(e, { openOptions: opts({ own: { vote: 'yes' }, b: { vote: 'maybe' }, c: { vote: 'no' } }) });
    expect(r).toEqual({ state: 'done', total: 3, exhausted: 1 });
  });

  it('skips people the event is hidden from', () => {
    const r = nextReminder(event({ hiddenFrom: ['A@x.com', 'b@x.com', 'c@x.com', 'd@x.com'] }), { openOptions: opts() });
    expect(r).toEqual({ state: 'done', total: 3, exhausted: 0 });
  });
});

describe('reminderSendDates', () => {
  it('lists logged sends oldest first, folding in the latest', () => {
    const r = reminderSendDates({
      autoRemindersSent: 2,
      autoReminderLog: ['2026-10-15T14:00:02Z', '2026-10-13T14:00:01Z'],
      lastAutoReminder: '2026-10-15T14:00:02Z',
    });
    expect(r.dates.map(d => d.toISOString())).toEqual(['2026-10-13T14:00:01.000Z', '2026-10-15T14:00:02.000Z']);
    expect(r.unknown).toBe(0);
  });

  it('counts sends from before the log as undated', () => {
    const r = reminderSendDates({ autoRemindersSent: 2, lastAutoReminder: '2026-10-15T14:00:02Z' });
    expect(r.dates).toHaveLength(1);
    expect(r.unknown).toBe(1);
  });

  it('is empty for someone never reminded', () => {
    expect(reminderSendDates({})).toEqual({ dates: [], unknown: 0 });
  });
});

describe('nextReminder once voting is over', () => {
  it('is off for a finalized or cancelled event, like the daily job', () => {
    const ar = { enabled: true, intervals: [3], startedAt: '2026-06-22T00:00:00Z' };
    expect(nextReminder({ autoReminders: ar, stage: 'finalized' }).state).toBe('off');
    expect(nextReminder({ autoReminders: ar, cancelled: true }).state).toBe('off');
  });
});
