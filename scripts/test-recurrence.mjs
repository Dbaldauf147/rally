// Tests for the recurring-event rules in src/recurrence.js — the date math
// behind "every year on the fourth Thursday of November" and the window that
// decides which occurrences get their own event document.
//
// Plain node, no test framework:  npm run test:recurrence
import {
  occurrencesAfter, describeRecurrence, nthWeekdayOfMonth, normalizeRecurrence,
  defaultRuleFromDate, occurrenceDocId, missingOccurrenceDates, ymd,
} from '../src/recurrence.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`); }
};
const D = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const list = (dates) => dates.map(ymd);

// --- nth weekday ---------------------------------------------------------
// Thanksgiving 2026 = 4th Thursday of November = Nov 26
eq('4th Thu Nov 2026', ymd(nthWeekdayOfMonth(2026, 10, 4, 4)), '2026-11-26');
// Memorial Day 2026 = last Monday of May = May 25
eq('last Mon May 2026', ymd(nthWeekdayOfMonth(2026, 4, 1, -1)), '2026-05-25');
// MLK 2027 = 3rd Monday of January = Jan 18
eq('3rd Mon Jan 2027', ymd(nthWeekdayOfMonth(2027, 0, 1, 3)), '2027-01-18');
// Feb 2026 has only 4 Sundays -> no 5th
eq('5th Sun Feb 2026 missing', nthWeekdayOfMonth(2026, 1, 0, 5), null);
// Aug 2026 has 5 Mondays (3,10,17,24,31)
eq('5th Mon Aug 2026', ymd(nthWeekdayOfMonth(2026, 7, 1, 5)), '2026-08-31');

// --- yearly, fixed date --------------------------------------------------
eq('yearly Nov 25 from Aug 2026',
  list(occurrencesAfter({ freq: 'yearly', mode: 'date', month: 10, day: 25 }, D('2026-08-16'), 3)),
  ['2026-11-25', '2027-11-25', '2028-11-25']);
// Already past this year's date -> starts next year
eq('yearly Mar 3 from Aug 2026',
  list(occurrencesAfter({ freq: 'yearly', mode: 'date', month: 2, day: 3 }, D('2026-08-16'), 2)),
  ['2027-03-03', '2028-03-03']);
// Feb 29 only exists in leap years — non-leap years are skipped, not clamped
eq('yearly Feb 29 skips non-leap',
  list(occurrencesAfter({ freq: 'yearly', mode: 'date', month: 1, day: 29 }, D('2026-01-01'), 3)),
  ['2028-02-29', '2032-02-29', '2036-02-29']);

// --- yearly, nth weekday -------------------------------------------------
eq('yearly 4th Thu Nov',
  list(occurrencesAfter({ freq: 'yearly', mode: 'nth', month: 10, weekday: 4, week: 4 }, D('2026-08-16'), 3)),
  ['2026-11-26', '2027-11-25', '2028-11-23']);
eq('yearly last Mon May',
  list(occurrencesAfter({ freq: 'yearly', mode: 'nth', month: 4, weekday: 1, week: -1 }, D('2026-08-16'), 3)),
  ['2027-05-31', '2028-05-29', '2029-05-28']);

// --- monthly -------------------------------------------------------------
eq('monthly 15th',
  list(occurrencesAfter({ freq: 'monthly', mode: 'date', day: 15 }, D('2026-08-16'), 3)),
  ['2026-09-15', '2026-10-15', '2026-11-15']);
// Day 31 skips the months that don't have one
eq('monthly 31st skips short months',
  list(occurrencesAfter({ freq: 'monthly', mode: 'date', day: 31 }, D('2026-01-01'), 5)),
  ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31', '2026-08-31']);
eq('monthly 1st Friday',
  list(occurrencesAfter({ freq: 'monthly', mode: 'nth', weekday: 5, week: 1 }, D('2026-08-16'), 3)),
  ['2026-09-04', '2026-10-02', '2026-11-06']);
// A 5th-weekday rule simply skips months without one
eq('monthly 5th Monday skips',
  list(occurrencesAfter({ freq: 'monthly', mode: 'nth', weekday: 1, week: 5 }, D('2026-01-01'), 3)),
  ['2026-03-30', '2026-06-29', '2026-08-31']);

// --- weekly --------------------------------------------------------------
// 2026-08-16 is a Sunday; Mon/Wed/Fri next up are 17th, 19th, 21st
eq('weekly Mon/Wed/Fri',
  list(occurrencesAfter({ freq: 'weekly', weekdays: [1, 3, 5] }, D('2026-08-16'), 5)),
  ['2026-08-17', '2026-08-19', '2026-08-21', '2026-08-24', '2026-08-26']);
eq('weekly single day',
  list(occurrencesAfter({ freq: 'weekly', weekdays: [0] }, D('2026-08-16'), 2)),
  ['2026-08-23', '2026-08-30']);

// --- until ---------------------------------------------------------------
eq('until stops the series',
  list(occurrencesAfter({ freq: 'monthly', mode: 'date', day: 15, until: '2026-10-31' }, D('2026-08-16'), 10)),
  ['2026-09-15', '2026-10-15']);
eq('until on the occurrence day still fires',
  list(occurrencesAfter({ freq: 'monthly', mode: 'date', day: 15, until: '2026-10-15' }, D('2026-08-16'), 10)),
  ['2026-09-15', '2026-10-15']);

// --- normalize / guards --------------------------------------------------
eq('no rule', normalizeRecurrence(null), null);
eq('bad freq', normalizeRecurrence({ freq: 'daily' }), null);
eq('weekly with no days is not a rule', normalizeRecurrence({ freq: 'weekly', weekdays: [] }), null);
eq('junk weekdays dropped', normalizeRecurrence({ freq: 'weekly', weekdays: [1, 9, 'x', 1, 3] }), { freq: 'weekly', weekdays: [1, 3], until: '' });
eq('out-of-range day clamped to default', normalizeRecurrence({ freq: 'monthly', mode: 'date', day: 99 }), { freq: 'monthly', mode: 'date', until: '', day: 1 });
eq('bad until dropped', normalizeRecurrence({ freq: 'monthly', mode: 'date', day: 5, until: 'nonsense' }).until, '');
eq('unusable rule yields no dates', occurrencesAfter({ freq: 'weekly', weekdays: [] }, D('2026-08-16'), 5), []);
eq('max 0 yields nothing', occurrencesAfter({ freq: 'monthly', mode: 'date', day: 5 }, D('2026-08-16'), 0), []);
eq('invalid date yields nothing', occurrencesAfter({ freq: 'monthly', mode: 'date', day: 5 }, new Date('nope'), 5), []);

// --- descriptions --------------------------------------------------------
eq('describe yearly date', describeRecurrence({ freq: 'yearly', mode: 'date', month: 10, day: 25 }), 'Every year on November 25');
eq('describe yearly nth', describeRecurrence({ freq: 'yearly', mode: 'nth', month: 10, weekday: 4, week: 4 }), 'Every year on the fourth Thursday of November');
eq('describe yearly last', describeRecurrence({ freq: 'yearly', mode: 'nth', month: 4, weekday: 1, week: -1 }), 'Every year on the last Monday of May');
eq('describe monthly date', describeRecurrence({ freq: 'monthly', mode: 'date', day: 22 }), 'Every month on the 22nd');
eq('describe monthly 3rd', describeRecurrence({ freq: 'monthly', mode: 'date', day: 3 }), 'Every month on the 3rd');
eq('describe monthly 11th', describeRecurrence({ freq: 'monthly', mode: 'date', day: 11 }), 'Every month on the 11th');
eq('describe monthly nth', describeRecurrence({ freq: 'monthly', mode: 'nth', weekday: 5, week: 1 }), 'Every month on the first Friday');
eq('describe weekly one', describeRecurrence({ freq: 'weekly', weekdays: [3] }), 'Every week on Wednesday');
eq('describe weekly many', describeRecurrence({ freq: 'weekly', weekdays: [1, 3, 5] }), 'Every week on Mon, Wed & Fri');
eq('describe until', describeRecurrence({ freq: 'weekly', weekdays: [1], until: '2027-01-04' }), 'Every week on Monday, until January 4, 2027');
eq('describe nothing', describeRecurrence(null), '');

// --- helpers -------------------------------------------------------------
eq('default rule from date', defaultRuleFromDate(D('2026-11-25'), 'yearly'),
  { freq: 'yearly', mode: 'date', month: 10, day: 25, weekday: 3, week: 4, weekdays: [3], until: '' });
eq('doc id is derived', occurrenceDocId('abc123', D('2027-11-25')), 'abc123__2027-11-25');

// --- rolling window: the generatedThrough contract ------------------------
// Simulates the materializer: the same rule re-run later only produces the
// dates beyond what was already generated, and never backfills deleted ones.
{
  const rule = { freq: 'monthly', mode: 'date', day: 15 };
  const first = occurrencesAfter(rule, D('2026-08-16'), 6);
  const through = ymd(first[first.length - 1]);
  eq('window 1', list(first), ['2026-09-15','2026-10-15','2026-11-15','2026-12-15','2027-01-15','2027-02-15']);
  // Same day, second app load: nothing new is past `through`.
  const again = occurrencesAfter(rule, D('2026-08-16'), 6).filter((d) => ymd(d) > through);
  eq('window 2 same day adds nothing', list(again), []);
  // Two months later the window has rolled forward.
  const later = occurrencesAfter(rule, D('2026-10-20'), 6).filter((d) => ymd(d) > through);
  eq('window 3 rolls forward', list(later), ['2027-03-15', '2027-04-15']);
}

// =========================================================================
// Which occurrences get a document: the rolling window, simulated over time
// against a fake event store.
// =========================================================================

// A store that behaves like the real one: run() is one app load — it creates
// what's missing and advances the series' generated-through mark.
const DT = (s) => { const [y, mo, d] = s.split('-').map(Number); return new Date(y, mo - 1, d, 18, 30); };

function makeStore(series) {
  const docs = new Map([[series.id, series]]);
  return {
    docs,
    ids: () => new Set(docs.keys()),
    run(now) {
      const s = docs.get(series.id);
      const wanted = missingOccurrenceDates(s, { now, existingIds: new Set(docs.keys()) });
      for (const d of wanted) {
        docs.set(occurrenceDocId(s.id, d), { id: occurrenceDocId(s.id, d), seriesId: s.id, date: d });
      }
      if (wanted.length) s.recurrenceGeneratedThrough = ymd(wanted[wanted.length - 1]);
      return list(wanted);
    },
    occurrenceDates: () => [...docs.values()].filter(d => d.seriesId).map(d => ymd(d.date)).sort(),
  };
}

// --- yearly: the plain case ----------------------------------------------
{
  const store = makeStore({
    id: 'bday', createdBy: 'u1', date: DT('2026-11-25'),
    recurrence: { freq: 'yearly', mode: 'date', month: 10, day: 25 },
  });
  // First load: the series' own date (Nov 2026) already covers the first of the
  // three upcoming dates, so only the next two are created.
  eq('yearly first load', store.run(DT('2026-08-16')), ['2027-11-25', '2028-11-25']);
  // Same day, reopened: nothing new.
  eq('yearly second load', store.run(DT('2026-08-16')), []);
  // A month later: still nothing, the window hasn't rolled.
  eq('yearly a month later', store.run(DT('2026-09-16')), []);
  // Once 2026 and 2027 are behind us the window has rolled two years on.
  eq('yearly after a year', store.run(DT('2027-12-01')), ['2029-11-25', '2030-11-25']);
  eq('yearly total docs', store.occurrenceDates(), ['2027-11-25', '2028-11-25', '2029-11-25', '2030-11-25']);
}

// --- a deleted occurrence stays deleted -----------------------------------
{
  const store = makeStore({
    id: 'std', createdBy: 'u1', date: DT('2026-09-04'),
    recurrence: { freq: 'monthly', mode: 'nth', weekday: 5, week: 1 },
  });
  // The series' own date is 2026-09-04, so the five after it are what's created.
  eq('monthly first load', store.run(DT('2026-08-16')),
    ['2026-10-02', '2026-11-06', '2026-12-04', '2027-01-01', '2027-02-05']);
  // ...and no second document lands on the series' own date.
  eq('series own date not duplicated', store.docs.has(occurrenceDocId('std', DT('2026-09-04'))), false);

  // The user deletes November's.
  store.docs.delete(occurrenceDocId('std', DT('2026-11-06')));
  eq('deleted one is gone', store.occurrenceDates().includes('2026-11-06'), false);
  // Reloading must not bring it back.
  eq('deleted stays deleted', store.run(DT('2026-08-16')), []);
  eq('still gone after reload', store.occurrenceDates().includes('2026-11-06'), false);
  // ...and the window still rolls forward normally afterwards.
  eq('window still rolls', store.run(DT('2026-12-20')), ['2027-03-05', '2027-04-02', '2027-05-07', '2027-06-04']);
}

// --- weekly ---------------------------------------------------------------
{
  const store = makeStore({
    id: 'gym', createdBy: 'u1', date: DT('2026-08-17'),
    recurrence: { freq: 'weekly', weekdays: [1, 3, 5] },
  });
  // Mon/Wed/Fri from a Monday-dated series: its own Aug 17 is one of the eight,
  // so seven get created.
  eq('weekly first load', store.run(DT('2026-08-16')),
    ['2026-08-19', '2026-08-21', '2026-08-24', '2026-08-26', '2026-08-28', '2026-08-31', '2026-09-02']);
  eq('weekly skips its own start date', store.run(DT('2026-08-16')).length, 0);
}

// --- an end date closes the series ---------------------------------------
{
  const store = makeStore({
    id: 'class', createdBy: 'u1', date: DT('2026-09-01'),
    recurrence: { freq: 'monthly', mode: 'date', day: 1, until: '2026-12-31' },
  });
  eq('until caps the run', store.run(DT('2026-08-16')), ['2026-10-01', '2026-11-01', '2026-12-01']);
  eq('nothing past the end date', store.run(DT('2027-06-01')), []);
}

// --- occurrences today still count ---------------------------------------
{
  const store = makeStore({
    id: 'today', createdBy: 'u1', date: DT('2026-01-15'),
    recurrence: { freq: 'monthly', mode: 'date', day: 16 },
  });
  const created = store.run(DT('2026-08-16'));
  eq("today's date is included, not skipped", created[0], '2026-08-16');
}

// --- guards ---------------------------------------------------------------
eq('no rule, nothing to do', missingOccurrenceDates({ id: 'x', date: DT('2026-01-01') }), []);
eq('bad rule, nothing to do', missingOccurrenceDates({ id: 'x', date: DT('2026-01-01'), recurrence: { freq: 'hourly' } }), []);
eq('unusable weekly rule', missingOccurrenceDates({ id: 'x', date: DT('2026-01-01'), recurrence: { freq: 'weekly', weekdays: [] } }), []);
eq('no date, nothing to do', missingOccurrenceDates({ id: 'x', recurrence: { freq: 'yearly', mode: 'date', month: 1, day: 3 } }), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
