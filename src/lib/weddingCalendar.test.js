import { describe, it, expect } from 'vitest';
import {
  calendarEntries, cleanTime, entriesByDay, formatTime, monthGrid, monthLabel, normalizeCalendar,
  removeEvent, saveEvent, shiftMonth, upcomingEntries,
} from './weddingCalendar';

describe('wedding calendar events', () => {
  it('cleans what is stored and drops what has no day or title', () => {
    const cal = normalizeCalendar({ events: [
      { id: 'a', date: '2027-03-06', time: '9:30', title: '  Tour Oheka ', kind: 'Venue tour', note: 'Bring\r\nquestions' },
      { id: 'a', date: '2027-03-07', title: 'Same id' },
      { id: 'b', date: '2027-02-30', title: 'Not a day' },
      { id: 'c', date: '2027-03-08', title: '   ' },
      'junk',
    ] });
    expect(cal.events).toHaveLength(2);
    expect(cal.events[0]).toEqual({ id: 'a', date: '2027-03-06', time: '09:30', title: 'Tour Oheka', kind: 'Venue tour', note: 'Bring\nquestions', done: false });
    expect(cal.events[1].id).not.toBe('a');
    expect(cal.events[1].kind).toBe('Other');
    expect(normalizeCalendar(undefined)).toEqual({ events: [] });
  });

  it('adds, replaces and removes', () => {
    let cal = saveEvent({ events: [] }, { id: 'x', date: '2027-03-06', title: 'Tasting' });
    cal = saveEvent(cal, { id: 'x', date: '2027-03-09', title: 'Tasting', time: '18:00' });
    expect(cal.events).toHaveLength(1);
    expect(cal.events[0]).toMatchObject({ date: '2027-03-09', time: '18:00' });
    expect(saveEvent(cal, { date: '2027-03-09', title: '' })).toBe(cal);
    expect(removeEvent(cal, 'x').events).toEqual([]);
  });

  it('reads and writes times', () => {
    expect([cleanTime('7:05'), cleanTime('24:00'), cleanTime('noon')]).toEqual(['07:05', '', '']);
    expect([formatTime('14:30'), formatTime('09:00'), formatTime('00:15'), formatTime('12:00'), formatTime('')]).toEqual(['2:30 PM', '9 AM', '12:15 AM', '12 PM', '']);
  });
});

describe('what lands on the calendar', () => {
  const calendar = { events: [
    { id: 'e1', date: '2027-06-12', time: '10:00', title: 'Hair', kind: 'Appointment', note: '', done: false },
    { id: 'e2', date: '2027-06-05', time: '', title: 'Final payment', kind: 'Payment due', note: '', done: true },
    { id: 'e3', date: '2027-06-12', time: '08:00', title: 'Breakfast', kind: 'Other', note: '', done: false },
  ] };
  const timeline = { date: '2027-06-12', items: [
    { id: 'wedding', daysBefore: 0, title: 'The wedding', note: '', milestone: true, done: false },
    { id: 'rehearsal', daysBefore: 1, title: 'Rehearsal', note: '', milestone: false, done: false },
    { id: 'thanks', daysBefore: -14, title: 'Thank-you notes', note: '', milestone: false, done: false },
  ] };
  const venues = [
    { id: 'v1', name: 'Oheka Castle', status: 'Replied', availableDates: ['2027-06-12', '2027-06-19', 'nonsense'] },
    { id: 'v2', name: 'Gone Barn', status: 'Not a fit', availableDates: ['2027-06-12'] },
    { id: 'v3', name: 'Hidden Hall', hidden: true, availableDates: ['2027-06-12'] },
  ];

  it('puts events, timeline items and venue dates in day order, the wedding first on its day', () => {
    const entries = calendarEntries({ calendar, timeline, venues });
    expect(entries.map((e) => `${e.date} ${e.title}`)).toEqual([
      '2027-06-05 Final payment',
      '2027-06-11 Rehearsal',
      '2027-06-12 The wedding',
      '2027-06-12 Oheka Castle is open',
      '2027-06-12 Breakfast',
      '2027-06-12 Hair',
      '2027-06-19 Oheka Castle is open',
      '2027-06-26 Thank-you notes',
    ]);
    expect(entries[2]).toMatchObject({ source: 'timeline', wedding: true, kind: 'Wedding day' });
    expect(entriesByDay(entries).get('2027-06-12')).toHaveLength(4);
  });

  it('leaves the timeline off with no wedding date, and each layer off when asked', () => {
    expect(calendarEntries({ calendar, timeline: { ...timeline, date: '' }, venues: [] }).every((e) => e.source === 'event')).toBe(true);
    const only = calendarEntries({ calendar, timeline, venues }, { timeline: false, venues: false });
    expect(only.map((e) => e.source)).toEqual(['event', 'event', 'event']);
    expect(calendarEntries()).toEqual([]);
  });

  it('lists what is ahead, without what is done or past', () => {
    const entries = calendarEntries({ calendar, timeline, venues: [] });
    expect(upcomingEntries(entries, '2027-06-01').map((e) => e.title)).toEqual(['Rehearsal', 'The wedding', 'Breakfast', 'Hair', 'Thank-you notes']);
    expect(upcomingEntries(entries, '2027-06-12', 2).map((e) => e.title)).toEqual(['The wedding', 'Breakfast']);
    expect(upcomingEntries(entries, '2027-07-01')).toEqual([]);
  });
});

describe('the month grid', () => {
  it('pads to whole weeks, Sunday first', () => {
    const june = monthGrid(2027, 6); // 1 June 2027 is a Tuesday
    expect(june).toHaveLength(5);
    expect(june[0].map((d) => d.date)).toEqual(['2027-05-30', '2027-05-31', '2027-06-01', '2027-06-02', '2027-06-03', '2027-06-04', '2027-06-05']);
    expect(june[0].map((d) => d.inMonth)).toEqual([false, false, true, true, true, true, true]);
    expect(june[4][6]).toEqual({ date: '2027-07-03', inMonth: false });
    expect(monthGrid(2026, 2)).toHaveLength(4); // Feb 2026: Sunday the 1st to Saturday the 28th
    expect(monthGrid(2027, 1)).toHaveLength(6); // Jan 2027 starts on a Friday
    expect(monthGrid(2026, 12).at(-1).at(-1).date).toBe('2027-01-02');
  });
  it('steps across years', () => {
    expect([shiftMonth('2026-12', 1), shiftMonth('2027-01', -1), shiftMonth('2027-06', 0)]).toEqual(['2027-01', '2026-12', '2027-06']);
    expect(monthLabel('2027-06')).toBe('June 2027');
  });
});
