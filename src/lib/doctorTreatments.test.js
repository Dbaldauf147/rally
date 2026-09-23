// Treatments: a course of something, across the months it covers.
import { describe, it, expect } from 'vitest';
import {
  monthKey, parseMonth, parseWhen, coversMonth, monthCoverage, isOngoing, fitRange, monthsBetween, overlapsRange, describeSpan,
  treatmentState, firstDay, lastDay, monthsAndDays, formatSpan, treatmentCounts, describeCounter, describeLength, normalizeTreatment, normalizeTreatments,
  addTreatment, updateTreatment, removeTreatment,
} from './doctorTreatments.js';

const TODAY = new Date(2026, 8, 21); // 2026-09-21

describe('month keys', () => {
  it('reads and writes YYYY-MM', () => {
    expect(monthKey(2026, 0)).toBe('2026-01');
    expect(monthKey(2026, 11)).toBe('2026-12');
    expect(parseMonth('2026-03')).toEqual({ year: 2026, month: 2 });
  });

  it('refuses anything that isn’t one', () => {
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('2026-3')).toBeNull();
    expect(parseMonth('March')).toBeNull();
    expect(parseMonth('')).toBeNull();
  });
});

describe('normalizeTreatment', () => {
  it('keeps what it can read and drops what it can’t', () => {
    expect(normalizeTreatment({ id: 't1', name: '  Physio ', start: '2026-03', end: '', notes: ' twice a week ' }))
      .toMatchObject({ id: 't1', name: 'Physio', start: '2026-03', end: '', notes: 'twice a week' });
    expect(normalizeTreatment({ name: 'Statin', start: 'soon', end: '2026-99' }))
      .toMatchObject({ start: '', end: '' });
  });

  it('swaps a range typed backwards rather than losing it', () => {
    expect(normalizeTreatment({ name: 'Invisalign', start: '2027-03', end: '2027-01' }))
      .toMatchObject({ start: '2027-01', end: '2027-03' });
  });

  it('gives a treatment an id when it arrives without one', () => {
    expect(normalizeTreatment({ name: 'Physio' }).id).toMatch(/\S/);
  });
});

describe('normalizeTreatments', () => {
  it('runs soonest first, the shorter course above the open-ended one', () => {
    const out = normalizeTreatments([
      { id: 'c', name: 'Statin', start: '2026-01' },
      { id: 'a', name: 'Physio', start: '2025-06', end: '2025-08' },
      { id: 'b', name: 'Invisalign', start: '2026-01', end: '2027-06' },
    ]);
    expect(out.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops the empty rows and survives junk', () => {
    expect(normalizeTreatments([{ name: '' }, { notes: 'stray' }])).toEqual([]);
    expect(normalizeTreatments(undefined)).toEqual([]);
  });
});

describe('coversMonth', () => {
  const physio = { name: 'Physio', start: '2026-03', end: '2026-05' };

  it('covers both ends and everything between', () => {
    expect(coversMonth(physio, '2026-03')).toBe(true);
    expect(coversMonth(physio, '2026-04')).toBe(true);
    expect(coversMonth(physio, '2026-05')).toBe(true);
  });

  it('stops either side of the range', () => {
    expect(coversMonth(physio, '2026-02')).toBe(false);
    expect(coversMonth(physio, '2026-06')).toBe(false);
  });

  it('runs on forever when there is no end', () => {
    const statin = { name: 'Statin', start: '2026-01' };
    expect(isOngoing(statin)).toBe(true);
    expect(coversMonth(statin, '2031-12')).toBe(true);
    expect(coversMonth(statin, '2025-12')).toBe(false);
  });

  it('covers nothing without a start', () => {
    expect(coversMonth({ name: 'Physio' }, '2026-03')).toBe(false);
  });
});

describe('fitRange', () => {
  it('falls back to this year with nothing placed', () => {
    expect(fitRange([], TODAY)).toEqual({ from: '2026-01', to: '2026-12' });
    expect(fitRange([{ name: 'Undated' }], TODAY)).toEqual({ from: '2026-01', to: '2026-12' });
  });

  it('snaps to the months the treatments cover, and no further', () => {
    expect(fitRange([
      { name: 'Physio', start: '2024-06-10', end: '2024-08-02' },
      { name: 'Antibiotics', start: '2024-07-01', end: '2024-07-14' },
    ], TODAY)).toEqual({ from: '2024-06', to: '2024-08' });
  });

  it('runs an ongoing course up to this month', () => {
    expect(fitRange([{ name: 'Statin', start: '2025-11-03' }], TODAY)).toEqual({ from: '2025-11', to: '2026-09' });
  });

  it('keeps a course that has not started yet, without reaching back to today', () => {
    expect(fitRange([{ name: 'Knee', start: '2027-04-01', end: '2027-06-30' }], TODAY)).toEqual({ from: '2027-04', to: '2027-06' });
    expect(fitRange([{ name: 'Knee', start: '2027-04' }], TODAY)).toEqual({ from: '2027-04', to: '2027-04' });
  });
});

describe('monthsBetween', () => {
  it('lists every month, both ends included, across a year boundary', () => {
    expect(monthsBetween('2025-11', '2026-02').map((m) => m.key)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthsBetween('2026-03', '2026-03')).toEqual([{ key: '2026-03', year: 2026, month: 2 }]);
  });

  it('reads a backwards range forwards, and nothing from nonsense', () => {
    expect(monthsBetween('2026-02', '2025-12').map((m) => m.key)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(monthsBetween('', '2026-01')).toEqual([]);
  });
});

describe('overlapsRange', () => {
  const physio = { name: 'Physio', start: '2024-06-10', end: '2024-08-02' };
  it('is true when any month of the course falls in the range', () => {
    expect(overlapsRange(physio, '2024-08', '2024-12')).toBe(true);
    expect(overlapsRange(physio, '2024-01', '2024-06')).toBe(true);
    expect(overlapsRange(physio, '2024-09', '2025-01')).toBe(false);
    expect(overlapsRange(physio, '2024-01', '2024-05')).toBe(false);
  });

  it('counts an ongoing course from its start onwards, and never an undated one', () => {
    expect(overlapsRange({ start: '2025-11' }, '2030-01', '2030-12')).toBe(true);
    expect(overlapsRange({ start: '2025-11' }, '2025-01', '2025-10')).toBe(false);
    expect(overlapsRange({ name: 'Undated' }, '2000-01', '2100-12')).toBe(false);
  });
});

describe('describeSpan', () => {
  it('reads as a span, an open end, or nothing yet', () => {
    expect(describeSpan({ start: '2027-03', end: '2027-06' })).toBe('Mar 2027 – Jun 2027');
    expect(describeSpan({ start: '2027-03' })).toBe('From Mar 2027');
    expect(describeSpan({ start: '2027-03', end: '2027-03' })).toBe('Mar 2027');
    expect(describeSpan({ name: 'Physio' })).toBe('No dates yet');
  });
});

describe('treatmentState', () => {
  it('says which side of today a course is on', () => {
    expect(treatmentState({ start: '2026-01', end: '2026-08' }, TODAY)).toBe('past');
    expect(treatmentState({ start: '2026-01', end: '2026-09' }, TODAY)).toBe('current');
    expect(treatmentState({ start: '2026-09', end: '2026-09' }, TODAY)).toBe('current');
    expect(treatmentState({ start: '2026-01' }, TODAY)).toBe('current');
    expect(treatmentState({ start: '2026-10' }, TODAY)).toBe('upcoming');
    expect(treatmentState({ name: 'Physio' }, TODAY)).toBe('unplaced');
  });
});

describe('editing', () => {
  const list = { entries: [], treatments: [{ id: 't1', name: 'Physio', start: '2026-03', end: '2026-05' }] };

  it('adds, updates and removes, keeping the order', () => {
    const added = addTreatment(list, { name: 'Statin', start: '2025-01' });
    expect(added.treatments.map((t) => t.name)).toEqual(['Statin', 'Physio']);
    expect(added.entries).toEqual([]);

    const edited = updateTreatment(added, 't1', { end: '2026-09' });
    expect(edited.treatments.find((t) => t.id === 't1').end).toBe('2026-09');

    expect(removeTreatment(edited, 't1').treatments.map((t) => t.name)).toEqual(['Statin']);
  });

  it('will not let a patch change the id out from under the row', () => {
    const edited = updateTreatment(list, 't1', { id: 'nope', name: 'Physio II' });
    expect(edited.treatments[0]).toMatchObject({ id: 't1', name: 'Physio II' });
  });
});

describe('days as well as months', () => {
  it('reads a day, a bare month, and refuses a day the month hasn’t got', () => {
    expect(parseWhen('2026-03-14')).toEqual({ year: 2026, month: 2, day: 14 });
    expect(parseWhen('2026-03')).toEqual({ year: 2026, month: 2, day: null });
    expect(parseWhen('2026-02-30')).toBeNull();
    expect(parseWhen('2028-02-29')).toEqual({ year: 2028, month: 1, day: 29 });
  });

  it('widens a bare month to the day it stands for at each end', () => {
    expect(firstDay('2026-02')).toBe('2026-02-01');
    expect(lastDay('2026-02')).toBe('2026-02-28');
    expect(firstDay('2026-02-10')).toBe('2026-02-10');
    expect(lastDay('')).toBe('');
  });

  it('keeps a day-precise range and swaps one typed backwards', () => {
    expect(normalizeTreatment({ name: 'Cast', start: '2026-03-14', end: '2026-04-02' }))
      .toMatchObject({ start: '2026-03-14', end: '2026-04-02' });
    expect(normalizeTreatment({ name: 'Cast', start: '2026-04-02', end: '2026-03-14' }))
      .toMatchObject({ start: '2026-03-14', end: '2026-04-02' });
    // A month and a day inside it are not backwards.
    expect(normalizeTreatment({ name: 'Cast', start: '2026-03-20', end: '2026-03' }))
      .toMatchObject({ start: '2026-03-20', end: '2026-03' });
  });

  it('covers the months its days fall in', () => {
    const cast = { name: 'Cast', start: '2026-03-14', end: '2026-05-02' };
    expect(coversMonth(cast, '2026-02')).toBe(false);
    expect(coversMonth(cast, '2026-03')).toBe(true);
    expect(coversMonth(cast, '2026-05')).toBe(true);
    expect(coversMonth(cast, '2026-06')).toBe(false);
  });

  it('fills part of the month a course starts or stops in', () => {
    const cast = { name: 'Cast', start: '2026-04-16', end: '2026-06-15' };
    expect(monthCoverage(cast, '2026-04')).toEqual({ from: 0.5, to: 1 });
    expect(monthCoverage(cast, '2026-05')).toEqual({ from: 0, to: 1 });
    expect(monthCoverage(cast, '2026-06')).toEqual({ from: 0, to: 0.5 });
    expect(monthCoverage(cast, '2026-07')).toBeNull();
    expect(monthCoverage({ start: '2026-04', end: '2026-06' }, '2026-04')).toEqual({ from: 0, to: 1 });
  });

  it('says finished the day after it ends, not at the end of the month', () => {
    expect(treatmentState({ start: '2026-09-01', end: '2026-09-20' }, TODAY)).toBe('past');
    expect(treatmentState({ start: '2026-09-01', end: '2026-09-21' }, TODAY)).toBe('current');
    expect(treatmentState({ start: '2026-09-22' }, TODAY)).toBe('upcoming');
  });

  it('reads the days in words', () => {
    expect(describeSpan({ start: '2026-03-14', end: '2026-04-02' })).toBe('Mar 14, 2026 – Apr 2, 2026');
    expect(describeSpan({ start: '2026-03-14' })).toBe('From Mar 14, 2026');
    expect(describeSpan({ start: '2026-03-14', end: '2026-03-14' })).toBe('Mar 14, 2026');
  });

  it('sorts a day and a bare month by when they actually start', () => {
    const out = normalizeTreatments([
      { id: 'b', name: 'Cast', start: '2026-03-14' },
      { id: 'a', name: 'Physio', start: '2026-03' },
    ]);
    expect(out.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('the counter', () => {
  // TODAY is 2026-09-21.
  it('counts months as calendar months, both ends included', () => {
    expect(monthsAndDays('2026-09-16', '2026-11-16')).toEqual({ months: 2, days: 0 });
    expect(monthsAndDays('2026-01-31', '2026-03-01')).toEqual({ months: 1, days: 1 });
    expect(monthsAndDays('2026-03-01', '2026-03-13')).toEqual({ months: 0, days: 12 });
    expect(formatSpan({ months: 1, days: 1 })).toBe('1 month 1 day');
    expect(formatSpan({ months: 2, days: 0 })).toBe('2 months');
  });

  it('crosses a clock change without losing a day', () => {
    // US DST ends 2026-11-01.
    expect(treatmentCounts({ start: '2026-10-25', end: '2026-11-07' }, TODAY).total).toBe(14);
  });

  it('says how far in you are on a course that is running', () => {
    expect(describeCounter({ start: '2026-09-14', end: '2026-11-13' }, TODAY)).toBe('Day 8 of 61 · 53 days left');
    expect(describeCounter({ start: '2026-09-01', end: '2026-09-21' }, TODAY)).toBe('Day 21 of 21 · last day');
    expect(describeCounter({ start: '2026-09-21', end: '2026-09-21' }, TODAY)).toBe('Day 1 of 1 · last day');
  });

  it('counts up with no end in sight', () => {
    expect(describeCounter({ start: '2026-09-10' }, TODAY)).toBe('Day 12');
    expect(describeCounter({ start: '2026-08-07' }, TODAY)).toBe('Day 46 (1 month 15 days)');
  });

  it('counts down to one that hasn’t started', () => {
    expect(describeCounter({ start: '2026-10-01', end: '2026-10-31' }, TODAY)).toBe('Starts in 10 days · 31 days (1 month)');
    expect(describeCounter({ start: '2026-09-22' }, TODAY)).toBe('Starts tomorrow');
  });

  it('gives the length of one that is done', () => {
    expect(describeCounter({ start: '2026-06-16', end: '2026-08-15' }, TODAY)).toBe('61 days (2 months)');
    expect(describeCounter({ start: '2026-09-01', end: '2026-09-10' }, TODAY)).toBe('10 days');
  });

  it('reads a bare month as the whole month', () => {
    expect(describeCounter({ start: '2026-03', end: '2026-05' }, TODAY)).toBe('92 days (3 months)');
  });

  it('shows the form the length of what is typed, once both ends are there', () => {
    expect(describeLength('2026-09-16', '2026-11-15')).toBe('61 days (2 months)');
    expect(describeLength('2026-09-16', '')).toBe('');
    expect(describeLength('2026-09-16', '2026-09-16')).toBe('1 day');
  });

  it('has nothing to count without a start', () => {
    expect(treatmentCounts({ name: 'Physio' }, TODAY)).toBeNull();
    expect(describeCounter({ name: 'Physio' }, TODAY)).toBe('');
  });
});

describe('not started', () => {
  // TODAY is 2026-09-21.
  it('keeps the flag, and only a real true sets it', () => {
    expect(normalizeTreatment({ name: 'Physio', notStarted: true }).notStarted).toBe(true);
    expect(normalizeTreatment({ name: 'Physio', notStarted: 'yes' }).notStarted).toBe(false);
    expect(normalizeTreatment({ name: 'Physio' }).notStarted).toBe(false);
  });

  it('is its own state whatever the dates say', () => {
    expect(treatmentState({ name: 'Physio', notStarted: true }, TODAY)).toBe('notstarted');
    expect(treatmentState({ start: '2026-09-01', end: '2026-12-01', notStarted: true }, TODAY)).toBe('notstarted');
    expect(treatmentState({ start: '2027-01-01', notStarted: true }, TODAY)).toBe('notstarted');
    expect(isOngoing({ start: '2026-09-01', notStarted: true })).toBe(false);
  });

  it('survives normalizeTreatments with no dates at all', () => {
    expect(normalizeTreatments([{ name: 'Physio', notStarted: true }])).toHaveLength(1);
  });

  it('counts toward the plan, or past it', () => {
    expect(describeCounter({ name: 'Physio', notStarted: true }, TODAY)).toBe('Not started');
    expect(describeCounter({ start: '2026-09-29', end: '2026-10-28', notStarted: true }, TODAY))
      .toBe('Not started · due in 8 days · planned 30 days (1 month)');
    expect(describeCounter({ start: '2026-09-22', notStarted: true }, TODAY)).toBe('Not started · due tomorrow');
    expect(describeCounter({ start: '2026-09-21', notStarted: true }, TODAY)).toBe('Not started · due today');
    expect(describeCounter({ start: '2026-09-16', notStarted: true }, TODAY)).toBe('Not started · 5 days overdue');
  });

  it('comes off with an edit, and the course runs as dated', () => {
    const list = { treatments: [{ id: 't1', name: 'Physio', start: '2026-09-14', end: '2026-11-13', notStarted: true }] };
    const started = updateTreatment(list, 't1', { notStarted: false });
    expect(treatmentState(started.treatments[0], TODAY)).toBe('current');
  });
});
