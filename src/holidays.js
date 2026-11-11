// Tracked holidays for the calendars, plans and date polls. The list — and the
// cadence each holiday follows — is the one on the Holidays page; only the
// holidays ticked "Cal" there are drawn. Long weekends (Memorial Day, Labor
// Day) are rules that span Sat–Sun–Mon, so the whole weekend shows as tracked.

import { occurrencesInRange, occurrencesForYear } from './lib/holidayRules';
import { loadHolidays, defaultHolidays } from './lib/holidayStore';

function forYear(list, year) {
  return list
    .filter((h) => h.calendar)
    .flatMap((h) => occurrencesForYear(h, year, list).map((o) => ({ name: h.name, dates: o.dates })))
    .sort((a, b) => a.dates[0].localeCompare(b.dates[0]));
}

// Returns [{ name, dates: ['YYYY-MM-DD', ...] }] for the given year.
export function getHolidaysForYear(year) {
  return forYear(loadHolidays(), year);
}

// The built-in holidays only, whatever has been renamed or removed on the
// Holidays page — for features keyed to a specific holiday by name.
export function getDefaultHolidaysForYear(year) {
  return forYear(defaultHolidays(), year);
}

// { 'YYYY-MM-DD': ['Memorial Day', ...] } across the given years.
export function getHolidayMap(years) {
  const list = loadHolidays();
  const map = {};
  for (const y of years) {
    for (const h of list) {
      if (!h.calendar) continue;
      // By range rather than by start year, so a span that began on Dec 30 of
      // the year before still marks its January days.
      for (const o of occurrencesInRange(h, `${y}-01-01`, `${y}-12-31`, list)) {
        for (const ds of o.dates) {
          const names = (map[ds] = map[ds] || []);
          if (!names.includes(h.name)) names.push(h.name);
        }
      }
    }
  }
  return map;
}
