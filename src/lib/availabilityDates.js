/* The dates a venue's free-text availability names, as "YYYY-MM-DD".

   The Availability column of the venue pricing sheet (Budget → Venue cost
   comparison) is written the way a venue says it:

     "Saturdays in June 2027 open; September 18, 2027 on hold until Dec 1"
     "No Saturdays left in 2027; Fridays and Sundays May to October 2027"

   Read one clause at a time (split on ";" and line breaks):
     • a date written out — "September 18, 2027", "Sep 18th 2027",
       "June 5, 12 and 19, 2027", "9/18/2027";
     • weekdays across months — "Saturdays in June 2027", "Fridays and
       Sundays May to October 2027", "Fridays in 2027" (every one of them).
   Nothing is guessed:
     • a clause that says a date is gone ("No Saturdays left", "booked",
       "unavailable", "sold out", "taken") gives no dates;
     • a date with no year, in a clause with no single year, is skipped;
     • a deadline ("on hold until Dec 1", "decide by March 3, 2027") isn't an
       open date;
     • months alone ("September and early October 2027") aren't specific
       enough to put on a calendar.
   Pure, so it can be tested without React. */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// Plural, or "every …": a weekday as a pattern, not the name of one date ("Sat, Jun 12, 2027").
const WEEKDAYS_RE = /\b(?:every\s+(sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?|(sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)days)\b/g;
const NEGATIVE = /\b(?:no|not|none|booked|unavailable|sold\s*out|taken|full|gone|closed|blacked?\s*out)\b/;
const DEADLINE = new RegExp(`\\b(?:until|till|til|by|before|deadline|expires?|release[sd]?)\\s+(?:${MONTH_RE}\\s+\\d{1,2}(?!\\d)(?:st|nd|rd|th)?(?:,?\\s*20\\d\\d)?|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?)`, 'g');

const pad = (n) => String(n).padStart(2, '0');
const monthIndex = (word) => MONTHS.indexOf(String(word).toLowerCase().slice(0, 3));
const iso = (y, m, d) => {
  const t = new Date(Date.UTC(y, m, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m && t.getUTCDate() === d ? `${y}-${pad(m + 1)}-${pad(d)}` : null;
};

function weekdaysIn(year, months, days) {
  const out = [];
  for (const m of months) {
    for (let d = 1; d <= 31; d += 1) {
      const t = new Date(Date.UTC(year, m, d));
      if (t.getUTCMonth() !== m) break;
      if (days.has(t.getUTCDay())) out.push(iso(year, m, d));
    }
  }
  return out;
}

function clauseDates(raw) {
  let c = ` ${raw.toLowerCase().replace(/[–—]/g, '-')} `;
  if (NEGATIVE.test(c)) return [];
  c = c.replace(DEADLINE, ' ');
  const years = [...new Set([...c.matchAll(/\b(20\d\d)\b/g)].map((m) => Number(m[1])))];
  const clauseYear = years.length === 1 ? years[0] : null;
  const out = [];

  // Dates written out: a month, one or more day numbers, then maybe a year.
  const written = new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?((?:\\s*(?:,|and|&)\\s*\\d{1,2}(?!\\d)(?:st|nd|rd|th)?)*)(?:,?\\s*(20\\d\\d))?`, 'g');
  for (const m of c.matchAll(written)) {
    const year = m[4] ? Number(m[4]) : clauseYear;
    if (!year) continue;
    const month = monthIndex(m[1]);
    for (const d of [m[2], ...(m[3].match(/\d{1,2}/g) || [])]) {
      const day = iso(year, month, Number(d));
      if (day) out.push(day);
    }
  }
  // 9/18/2027 or 9/18/27 (month first, as written in the US).
  for (const m of c.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d\d|\d\d)\b/g)) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const day = iso(year, Number(m[1]) - 1, Number(m[2]));
    if (day) out.push(day);
  }

  // Weekdays across months: "Saturdays in June 2027", "Fridays and Sundays May to October 2027".
  const days = new Set([...c.matchAll(WEEKDAYS_RE)].map((m) => DAYS.indexOf((m[1] || m[2]).slice(0, 3))));
  if (days.size && clauseYear) {
    // Months not followed by a day number (those were dates, above).
    const bare = [...c.matchAll(new RegExp(`\\b${MONTH_RE}(?!\\s+\\d{1,2}(?!\\d))`, 'g'))].map((m) => ({ at: m.index, month: monthIndex(m[1]) }));
    const range = c.match(new RegExp(`\\b${MONTH_RE}\\s*(?:to|through|thru|until|till|-)\\s*${MONTH_RE}`));
    let months;
    if (range) {
      const from = monthIndex(range[1]);
      const to = monthIndex(range[2]);
      months = [];
      for (let m = from; m <= (to >= from ? to : to + 12); m += 1) months.push(m % 12);
      if (to < from) months = months.filter((m) => m >= from); // "November to February 2027": don't run into another year
    } else if (bare.length) {
      months = [...new Set(bare.map((b) => b.month))];
    } else {
      months = [...Array(12).keys()]; // "Fridays in 2027"
    }
    out.push(...weekdaysIn(clauseYear, months, days));
  }
  return out;
}

export function datesFromAvailability(text) {
  const clauses = String(text || '').split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
  return [...new Set(clauses.flatMap(clauseDates))].sort();
}

/* A short way to show a list of dates: every one when there are a few,
   else how many and the span. */
export function summarizeDates(list) {
  const fmt = (d, year = true) => {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) });
  };
  if (!list?.length) return '';
  if (list.length <= 5) return list.map((d) => fmt(d)).join('; ');
  return `${list.length} dates, ${fmt(list[0])} – ${fmt(list[list.length - 1])}`;
}
