import { getDefaultHolidaysForYear } from '../holidays';

/* Mother's Day and Father's Day on the Reach Out page.

   A friend is tagged with the Mom / Dad boxes on their Friends pop-up
   (`isMom`, `isDad`). On the day itself, everyone carrying that tag is
   gathered into one card, so the calls happen together instead of being
   scattered through the overdue sort. The dates come from the built-in holiday
   rules (not the editable list), so renaming or removing Mother's Day on the
   Holidays page cannot switch this card off. */

export const PARENT_HOLIDAYS = [
  { key: 'mom', field: 'isMom', name: "Mother's Day", emoji: '💐', label: 'moms' },
  { key: 'dad', field: 'isDad', name: "Father's Day", emoji: '👔', label: 'dads' },
];

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// The parent holiday falling on `today`, or null.
export function parentHolidayOn(today) {
  if (!(today instanceof Date) || isNaN(today)) return null;
  const key = ymd(today);
  const names = new Set(getDefaultHolidaysForYear(today.getFullYear())
    .filter((h) => h.dates.includes(key))
    .map((h) => h.name));
  return PARENT_HOLIDAYS.find((h) => names.has(h.name)) || null;
}

// The friends tagged for that holiday, by name.
export function parentsFor(friends, holiday) {
  if (!holiday) return [];
  return (friends || [])
    .filter((f) => f?.[holiday.field] === true)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
