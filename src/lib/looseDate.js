// Reading the loose dates a human or a spreadsheet writes.
//
// Lifted out of friends.js so it can be imported without dragging Firestore
// along with it: customFields.js needs the parsing, and the doctors list needs
// customFields — and neither can load Firestore in a unit test.
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export const pad2 = (n) => String(n).padStart(2, '0');

// Pull {month, day, year} out of the loose date text a human or a spreadsheet
// might supply. Year is null when the text carries none.
export function parseLooseDate(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  let m;
  // 1985-07-30, and the vCard no-year form --07-30
  if ((m = /^(\d{4})?-{1,2}(\d{1,2})-(\d{1,2})$/.exec(s))) {
    return { year: m[1] ? Number(m[1]) : null, month: Number(m[2]), day: Number(m[3]) };
  }
  // 7/30, 7/30/1985, 7-30-85
  if ((m = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/.exec(s))) {
    let year = m[3] ? Number(m[3]) : null;
    if (year != null && m[3].length === 2) year += year > 30 ? 1900 : 2000;
    return { year, month: Number(m[1]), day: Number(m[2]) };
  }
  // July 30, 1985 / Jul 30
  if ((m = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/i.exec(s))) {
    const mi = MONTH_ABBR.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi >= 0) return { year: m[3] ? Number(m[3]) : null, month: mi + 1, day: Number(m[2]) };
  }
  return null;
}
export const validParts = (p) => !!p && p.month >= 1 && p.month <= 12 && p.day >= 1 && p.day <= 31;

// ── Dates that come round every year ──────────────────────────────────────
// An anniversary is a birthday's cousin: the month and day are the part that
// recurs, and the year — when it's known — is what turns the date into "their
// 10th". One stored field carries both cases: YYYY-MM-DD with a year,
// MM-DD without, since a half-remembered 6/2 is still worth keeping.
export function normalizeAnnualDate(input) {
  const p = parseLooseDate(input);
  if (!validParts(p)) return '';
  return p.year ? `${p.year}-${pad2(p.month)}-${pad2(p.day)}` : `${pad2(p.month)}-${pad2(p.day)}`;
}

// 6/2/2015, or 6/2 when the year was never recorded.
export function formatAnnualDate(value) {
  const p = parseLooseDate(value);
  if (!validParts(p)) return '';
  return p.year ? `${p.month}/${p.day}/${p.year}` : `${p.month}/${p.day}`;
}

// Where a yearly date sits relative to today: whether it lands today, how many
// days until the next one comes round, and which anniversary that next one is.
// `years` is null without a start year — the date still recurs, there's just no
// number to put on it. Null for anything that isn't a date.
export function annualDateInfo(value, today = new Date()) {
  const p = parseLooseDate(value);
  if (!validParts(p)) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const isToday = p.month === start.getMonth() + 1 && p.day === start.getDate();
  let next = new Date(start.getFullYear(), p.month - 1, p.day);
  if (next < start) next = new Date(start.getFullYear() + 1, p.month - 1, p.day);
  return {
    month: p.month,
    day: p.day,
    year: p.year,
    isToday,
    daysUntil: Math.round((next - start) / 86400000),
    years: p.year ? next.getFullYear() - p.year : null,
  };
}
