// The birthdays section of the weekly digest: friends with "Email me before
// their birthday" ticked on the friend pop-up (`birthdayEmail` on the friend
// doc) whose birthday lands in the next three weeks, with the gift ideas saved
// for them.
import { annualDateInfo } from './looseDate.js';
import { giftIdeasOf } from './gifts.js';

export const BIRTHDAY_LOOKAHEAD_DAYS = 21;

/**
 * The calendar day it is in `timeZone`, as a local-midnight Date. The digest
 * runs on a server in UTC; "three weeks from today" should be counted from the
 * reader's day, not the server's.
 */
export function dayInZone(now = new Date(), timeZone = 'America/New_York') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(now).map((p) => [p.type, Number(p.value)]),
  );
  return new Date(parts.year, parts.month - 1, parts.day);
}

/**
 * Opted-in friends with a birthday in the next `days` days (today included),
 * soonest first: { id, name, date, daysUntil, turning, giftIdeas }.
 * The day comes from `birthday`, or the date of birth when that's all there
 * is; `turning` is null unless the date of birth supplies a year.
 */
export function upcomingBirthdays(friends, today = new Date(), days = BIRTHDAY_LOOKAHEAD_DAYS) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const out = [];
  for (const f of Array.isArray(friends) ? friends : []) {
    if (!f || f.birthdayEmail !== true) continue;
    const info = annualDateInfo(f.birthday, start) || annualDateInfo(f.dob, start);
    if (!info || info.daysUntil > days) continue;
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + info.daysUntil);
    const born = annualDateInfo(f.dob, start)?.year;
    const turning = born ? date.getFullYear() - born : null;
    out.push({
      id: String(f.id ?? ''),
      name: String(f.name ?? '').trim() || 'Unnamed',
      date,
      daysUntil: info.daysUntil,
      turning: turning != null && turning > 0 && turning < 150 ? turning : null,
      giftIdeas: giftIdeasOf(f),
    });
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
}
