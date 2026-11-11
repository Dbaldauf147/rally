/* Holiday reach-outs: a contact tagged with a holiday on their Friends pop-up
   (`holidayTags`, a list of holiday ids from the Holidays page) is someone to
   reach out to on that holiday. On the day, the Reach Out page gathers them
   into a card, and the daily /api/holiday-reachout cron sends a notification.

   The holiday list itself lives in localStorage (holidayStore.js), which the
   server can't read, so a copy is mirrored onto the user doc as
   `users/{uid}.holidayList` whenever it changes. Without one the server falls
   back to the built-in holidays, which is also what the device shows until
   the Holidays page is first edited.

   Pure, and imported by the api/ route — keep the .js extensions. */

import { normalizeHoliday, defaultHolidays } from './holidayStore.js';
import { occurrencesInRange } from './holidayRules.js';

// A friend's tagged holiday ids: unique, non-empty strings, in tag order.
export function holidayTagsOf(friend) {
  const raw = Array.isArray(friend?.holidayTags) ? friend.holidayTags : [];
  return [...new Set(raw.filter((id) => typeof id === 'string' && id))];
}

// The holiday list as the server should read it: the mirrored copy when there
// is one, else the built-ins.
export function holidayListFrom(stored) {
  return Array.isArray(stored) && stored.length ? stored.map(normalizeHoliday) : defaultHolidays();
}

// The copy written to the user doc: just what the rules need.
export function holidayListForSync(list) {
  return (list || []).map((h) => {
    const n = normalizeHoliday(h);
    return { id: n.id, name: n.name, rule: n.rule };
  });
}

// The holidays that begin on `todayIso`. A span (Memorial Day weekend, a
// multi-day holiday) counts once, on its first day, so it's one nudge and not
// three. Ticked "Cal" or not — the tag is what asks for the reminder.
export function holidaysStartingOn(list, todayIso) {
  return (list || []).filter((h) => h?.name
    && occurrencesInRange(h, todayIso, todayIso, list).some((o) => o.start === todayIso));
}

// [{ holiday, friends }] for every holiday beginning today with at least one
// tagged friend; friends sorted by name, holidays in list order.
export function holidayReachOutsOn(friends, list, todayIso) {
  const out = [];
  for (const holiday of holidaysStartingOn(list, todayIso)) {
    const tagged = (friends || [])
      .filter((f) => f && holidayTagsOf(f).includes(holiday.id))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (tagged.length) out.push({ holiday, friends: tagged });
  }
  return out;
}

// "Ann", "Ann and Bo", "Ann, Bo and 2 others".
export function namesText(names, max = 3) {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list.join('');
  if (list.length <= max) return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  const rest = list.length - (max - 1);
  return `${list.slice(0, max - 1).join(', ')} and ${rest} others`;
}

// The notification for one day's reach-outs: { title, body }, or null when
// there is nothing to say.
export function holidayReachOutMessage(groups) {
  if (!groups?.length) return null;
  const total = groups.reduce((n, g) => n + g.friends.length, 0);
  const title = groups.length === 1
    ? `${groups[0].holiday.name}: reach out to ${total === 1 ? groups[0].friends[0].name : `${total} people`}`
    : `Holiday reach-outs: ${total} ${total === 1 ? 'person' : 'people'}`;
  const body = groups
    .map((g) => `${g.holiday.name} — ${namesText(g.friends.map((f) => f.name))}`)
    .join('\n');
  return { title, body };
}
