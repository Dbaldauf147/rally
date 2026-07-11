// Tracked holidays, computed per year. Weekend holidays (Memorial Day, Labor
// Day) expand to the full Sat–Sun–Mon weekend so the whole weekend shows as
// tracked on the calendars.

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// nth weekday of a month. weekday: 0=Sun..6=Sat. n: 1-based, or -1 for the last.
function nthWeekday(year, month, weekday, n) {
  if (n < 0) {
    const last = new Date(year, month + 1, 0);
    const offset = (last.getDay() - weekday + 7) % 7;
    return new Date(year, month, last.getDate() - offset);
  }
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}

// Returns [{ name, dates: ['YYYY-MM-DD', ...] }] for the given year.
export function getHolidaysForYear(year) {
  const mlk = nthWeekday(year, 0, 1, 3);              // 3rd Monday of January
  const mothersDay = nthWeekday(year, 4, 0, 2);       // 2nd Sunday of May
  const memorial = nthWeekday(year, 4, 1, -1);        // last Monday of May
  const fathersDay = nthWeekday(year, 5, 0, 3);       // 3rd Sunday of June
  const labor = nthWeekday(year, 8, 1, 1);            // 1st Monday of September
  const thanksgiving = nthWeekday(year, 10, 4, 4);    // 4th Thursday of November

  const single = (name, d) => ({ name, dates: [ymd(d)] });
  // A Monday holiday plus the preceding Saturday and Sunday.
  const longWeekend = (name, monday) => ({
    name,
    weekend: true,
    dates: [ymd(addDays(monday, -2)), ymd(addDays(monday, -1)), ymd(monday)],
  });

  return [
    single("New Year's Day", new Date(year, 0, 1)),
    single('MLK Jr Day', mlk),
    single("St Patrick's Day", new Date(year, 2, 17)),
    single("Mother's Day", mothersDay),
    longWeekend('Memorial Day', memorial),
    single("Father's Day", fathersDay),
    single('Independence Day', new Date(year, 6, 4)),
    longWeekend('Labor Day', labor),
    single('Halloween', new Date(year, 9, 31)),
    single('Thanksgiving Day', thanksgiving),
    single('Day after Thanksgiving', addDays(thanksgiving, 1)),
    single('Christmas Eve', new Date(year, 11, 24)),
    single('Christmas Day', new Date(year, 11, 25)),
    single("New Year's Eve", new Date(year, 11, 31)),
  ];
}

// { 'YYYY-MM-DD': ['Memorial Day', ...] } across the given years.
export function getHolidayMap(years) {
  const map = {};
  for (const y of years) {
    for (const h of getHolidaysForYear(y)) {
      for (const ds of h.dates) {
        (map[ds] = map[ds] || []).push(h.name);
      }
    }
  }
  return map;
}
