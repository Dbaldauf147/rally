import { describe, it, expect } from 'vitest';
import { readyToStartReminders } from './autoReminders';

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
