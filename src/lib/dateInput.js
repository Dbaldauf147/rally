// Turning what someone types in a date field into a real calendar date.
//
// Every date field in the app is a DateField, whose popup carries a type-in bar
// above the calendar. This is the layer that reads that bar. The loose-text
// parsing itself already exists for spreadsheet imports (parseLooseDate), so we
// lean on it and add the bits a date *entry* box needs: a default year, the
// relative words people actually type, and a real-calendar check so 2/30 is
// rejected rather than silently rolled into March.
import { parseLooseDate, validParts, pad2 } from './looseDate';

export const toISO = (year, month, day) => `${year}-${pad2(month)}-${pad2(day)}`;

// Does this y/m/d name a day that exists? Date() rolls overflow forward
// (Feb 30 -> Mar 2), so compare the parts back out to catch it.
export function isRealDate(year, month, day) {
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

const RELATIVE = { today: 0, tomorrow: 1, yesterday: -1 };

// Text -> 'YYYY-MM-DD', or null when it isn't a date yet. `today` is injectable
// so the relative words are testable without leaning on the clock.
export function parseTypedDate(input, today = new Date()) {
  const s = String(input ?? '').trim();
  if (!s) return null;

  const rel = RELATIVE[s.toLowerCase()];
  if (rel !== undefined) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + rel);
    return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  const parts = parseLooseDate(s);
  if (!validParts(parts)) return null;
  // A bare "9/12" or "Sep 12" means this year — the calendar is right there to
  // correct it if they meant another one.
  const year = parts.year ?? today.getFullYear();
  if (!isRealDate(year, parts.month, parts.day)) return null;
  return toISO(year, parts.month, parts.day);
}

// 'YYYY-MM-DD' -> 'MM/DD/YYYY' for the closed field. Anything else passes
// through untouched so a half-written value never renders as garbage.
export function formatDateValue(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim());
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
}

// 'YYYY-MM-DD' -> a local midnight Date. Parsing the string directly would give
// UTC and shift the day for anyone west of Greenwich.
export function isoToDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim());
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export const dateToISO = (d) => toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());

// Is `iso` inside the optional min/max bounds? Both are 'YYYY-MM-DD', which
// compares correctly as plain strings.
export function withinBounds(iso, min, max) {
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}
