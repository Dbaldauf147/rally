// Treatments: a course of something, across the months it covers.
import { describe, it, expect } from 'vitest';
import {
  monthKey, parseMonth, coversMonth, isOngoing, gridYears, describeSpan,
  treatmentState, normalizeTreatment, normalizeTreatments,
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

describe('gridYears', () => {
  it('always includes this year', () => {
    expect(gridYears([], TODAY)).toEqual([2026]);
  });

  it('reaches back to the earliest start and on to the latest end', () => {
    expect(gridYears([
      { name: 'Physio', start: '2024-06', end: '2024-08' },
      { name: 'Invisalign', start: '2026-01', end: '2028-06' },
    ], TODAY)).toEqual([2024, 2025, 2026, 2027, 2028]);
  });

  it('makes room for a course that has not started yet', () => {
    expect(gridYears([{ name: 'Knee', start: '2027-04' }], TODAY)).toEqual([2026, 2027]);
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
