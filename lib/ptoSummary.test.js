import { describe, it, expect } from 'vitest';
import {
  ptoSummaryConfig, isPtoSummaryDue, summarizePtoYear, groupStretches, buildPtoEmail, fmtDays,
  DEFAULT_RECIPIENT, OWNER_EMAIL,
} from './ptoSummary.js';

const pto = {
  years: [
    { year: 2026, total: 27, eoyBackup: 5, start: '2026-01-01', end: '2026-12-31' },
    { year: 2027, total: 27, eoyBackup: 5, start: '2027-01-01', end: '2027-12-31' },
  ],
  entries: [
    // Google import writes one row per weekday.
    { id: 'a', label: 'PTO', rallyName: 'Spring break', start: '2026-03-02', end: '2026-03-02', days: 1 },
    { id: 'b', label: 'PTO', rallyName: 'Spring break', start: '2026-03-03', end: '2026-03-03', days: 1 },
    { id: 'c', label: 'PTO', rallyName: 'Long weekend', start: '2026-05-22', end: '2026-05-22', days: 1 },
    // Fri then Mon: still one stretch.
    { id: 'd', label: 'PTO', rallyName: 'Long weekend', start: '2026-05-25', end: '2026-05-25', days: 1 },
    { id: 'e', label: 'Half day', start: '2026-07-02', end: '2026-07-02', days: 0.5 },
    { id: 'f', label: 'Thanksgiving', start: '2026-11-25', end: '2026-11-27', days: 3 },
    { id: 'g', label: 'Today off', start: '2026-11-01', end: '2026-11-01', days: 1 },
    { id: 'h', label: 'Next year', start: '2027-01-05', end: '2027-01-05', days: 1 },
  ],
};

describe('settings', () => {
  it('starts the owner on, sending to the work address', () => {
    expect(ptoSummaryConfig({ email: OWNER_EMAIL })).toMatchObject({ enabled: true, emails: [DEFAULT_RECIPIENT] });
  });
  it('keeps anyone else off until they turn it on', () => {
    expect(ptoSummaryConfig({ email: 'someone@else.com' })).toMatchObject({ enabled: false, emails: [] });
  });
  it('uses the saved list, even an emptied one, and drops bad or repeated addresses', () => {
    expect(ptoSummaryConfig({ email: OWNER_EMAIL, ptoSummary: { emails: [] } }).emails).toEqual([]);
    expect(ptoSummaryConfig({ email: OWNER_EMAIL, ptoSummary: { emails: ['Me@Home.com', 'me@home.com', 'nope', ' '] } }).emails)
      .toEqual(['me@home.com']);
    expect(ptoSummaryConfig({ email: OWNER_EMAIL, ptoSummary: { enabled: false } }).enabled).toBe(false);
  });
});

describe('when it sends', () => {
  const cfg = ptoSummaryConfig({ email: OWNER_EMAIL });
  it('sends at 8 AM Eastern on November 1st, EDT or EST', () => {
    expect(isPtoSummaryDue(cfg, new Date('2026-11-01T12:00:00Z'))).toBe(false); // Nov 1 2026 is a Sunday: EST, 7 AM
    expect(isPtoSummaryDue(cfg, new Date('2026-11-01T13:00:00Z'))).toBe(true);
    expect(isPtoSummaryDue(cfg, new Date('2027-11-01T12:00:00Z'))).toBe(true); // still EDT
  });
  it('sends once a year', () => {
    expect(isPtoSummaryDue({ ...cfg, lastSentYear: 2026 }, new Date('2026-11-01T13:00:00Z'))).toBe(false);
    expect(isPtoSummaryDue({ ...cfg, lastSentYear: 2025 }, new Date('2026-11-01T13:00:00Z'))).toBe(true);
  });
  it('not on other days, or when off or addressed to nobody', () => {
    expect(isPtoSummaryDue(cfg, new Date('2026-11-02T13:00:00Z'))).toBe(false);
    expect(isPtoSummaryDue({ ...cfg, enabled: false }, new Date('2026-11-01T13:00:00Z'))).toBe(false);
    expect(isPtoSummaryDue({ ...cfg, emails: [] }, new Date('2026-11-01T13:00:00Z'))).toBe(false);
  });
});

describe('the year summarised', () => {
  const s = summarizePtoYear(pto, 2026, '2026-11-01');
  it('counts like the PTO page: before today is taken, today on is scheduled', () => {
    expect(s.taken).toBe(4.5);
    expect(s.scheduled).toBe(4);
    expect(s.left).toBe(27 - 4.5 - 4);
    expect(s.afterBackup).toBe(27 - 4.5 - 4 - 5);
  });
  it('lists the days as stretches, in date order', () => {
    expect(s.takenList.map((r) => [r.name, r.start, r.end, r.days])).toEqual([
      ['Spring break', '2026-03-02', '2026-03-03', 2],
      ['Long weekend', '2026-05-22', '2026-05-25', 2],
      ['Half day', '2026-07-02', '2026-07-02', 0.5],
    ]);
    expect(s.scheduledList.map((r) => r.name)).toEqual(['Today off', 'Thanksgiving']);
  });
  it("doesn't join days with a gap or a different name", () => {
    const rows = groupStretches([
      { label: 'A', start: '2026-03-02', days: 1 },
      { label: 'A', start: '2026-03-04', days: 1 },
      { label: 'B', start: '2026-03-05', days: 1 },
    ]);
    expect(rows.map((r) => [r.name, r.start, r.end])).toEqual([
      ['A', '2026-03-02', '2026-03-02'], ['A', '2026-03-04', '2026-03-04'], ['B', '2026-03-05', '2026-03-05'],
    ]);
  });
  it('says so when the year has no allowance set', () => {
    const none = summarizePtoYear({ years: [], entries: pto.entries }, 2026, '2026-11-01');
    expect(none.hasYear).toBe(false);
    expect(buildPtoEmail(none).html).toMatch(/no 2026 allowance/);
  });
});

describe('the email', () => {
  it('leads with days left, scheduled and taken, and lists both', () => {
    const { subject, html } = buildPtoEmail(summarizePtoYear(pto, 2026, '2026-11-01'));
    expect(subject).toBe('2026 PTO: 18.5 days left, 4 scheduled, 4.5 taken');
    expect(html).toMatch(/Mon Mar 2 – Tue Mar 3/);
    expect(html).toMatch(/Spring break/);
    expect(html).toMatch(/Wed Nov 25 – Fri Nov 27/);
    expect(html).toMatch(/13.5 days<\/strong> to plan/);
  });
  it('escapes names', () => {
    const { html } = buildPtoEmail(summarizePtoYear({ years: pto.years, entries: [{ label: '<b>Tom & Jerry</b>', start: '2026-02-02', days: 1 }] }, 2026, '2026-11-01'));
    expect(html).toContain('&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;');
  });
  it('formats days', () => {
    expect([fmtDays(2), fmtDays(1.5), fmtDays(-0.5), fmtDays('x')]).toEqual(['2', '1.5', '−0.5', '0']);
  });
});
