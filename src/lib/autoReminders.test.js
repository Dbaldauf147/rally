import { describe, it, expect } from 'vitest';
import { readyToStartReminders, pendingReminderMembers, nextReminderSend } from './autoReminders';

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

describe('nextReminderSend', () => {
  // Started by the 14:00 UTC cron run on Oct 1, reminders on days 3, 5 and 7.
  const running = (members, extra = {}) => ({
    autoReminders: { enabled: true, intervals: [3, 5, 7], startedAt: '2026-10-01T14:00:05Z' },
    members,
    ...extra,
  });
  const now = new Date('2026-10-02T09:00:00Z');
  const guest = (extra = {}) => ({ name: 'G', email: 'g@x.com', ...extra });

  it('is off, or waiting, before there is a schedule to report', () => {
    expect(nextReminderSend({}, new Set(), now)).toEqual({ state: 'off' });
    expect(nextReminderSend({ autoReminders: { enabled: false, intervals: [3] } }, new Set(), now)).toEqual({ state: 'off' });
    expect(nextReminderSend(armed(), new Set(), now)).toEqual({ state: 'waiting' });
  });

  it('names the daily run that will send the next one, and how many go then', () => {
    // Due 3 days after 14:00:05 on Oct 1 — the 14:00 run on Oct 4 is a few
    // seconds short, so it goes on Oct 5's.
    const out = nextReminderSend(running({ a: guest(), b: guest(), c: guest({ autoRemindersSent: 1 }) }), new Set(), now);
    expect(out).toEqual({ state: 'scheduled', at: new Date('2026-10-05T14:00:00Z'), count: 2 });
  });

  it('puts an overdue reminder on the next run', () => {
    const late = new Date('2026-10-20T15:00:00Z');
    expect(nextReminderSend(running({ a: guest() }), new Set(), late).at).toEqual(new Date('2026-10-21T14:00:00Z'));
  });

  it('is done when everyone has voted, been sent every reminder, or is not emailed', () => {
    const members = {
      voted: guest(),
      finished: guest({ autoRemindersSent: 3 }),
      noEmail: { name: 'N' },
      skip: guest({ skipVote: true }),
      hidden: guest({ email: 'Secret@x.com' }),
    };
    const event = running(members, { hiddenFrom: ['secret@x.com'] });
    expect(pendingReminderMembers(event, new Set(['voted']))).toEqual([]);
    expect(nextReminderSend(event, new Set(['voted']), now)).toEqual({ state: 'done' });
  });
});
