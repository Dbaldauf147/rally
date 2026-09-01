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
