// A friend's kids, kept on the friend doc as `kids: [{ name, birthday }]`.
//
// The birthday is stored the way an anniversary is (lib/looseDate.js):
// YYYY-MM-DD when the year is known, MM-DD when it isn't — a kid's birthday is
// often remembered as "the 14th of March" long before anyone knows the year,
// and the year, when there is one, is what puts an age next to the name.
import { normalizeAnnualDate, formatAnnualDate, annualDateInfo } from './looseDate';

// For the editor: dates in the short form people type, never an empty list.
export function kidsForEditing(kids) {
  const rows = (Array.isArray(kids) ? kids : [])
    .filter((k) => k && typeof k === 'object')
    .map((k) => ({ name: String(k.name || ''), birthday: formatAnnualDate(k.birthday) || String(k.birthday || '') }));
  return rows.length > 0 ? rows : [{ name: '', birthday: '' }];
}

// For the doc: rows without a name are dropped (a birthday alone names no
// one), and a date that won't parse is cleared rather than stored half-read.
export function kidsForSaving(kids) {
  return (Array.isArray(kids) ? kids : [])
    .map((k) => ({ name: String(k?.name || '').trim(), birthday: normalizeAnnualDate(k?.birthday) }))
    .filter((k) => k.name);
}

// Age today, from a birthday that carries its year. Null without one.
export function kidAge(birthday, today = new Date()) {
  const info = annualDateInfo(birthday, today);
  if (!info?.year) return null;
  const age = info.isToday ? info.years : info.years - 1;
  return age >= 0 && age < 120 ? age : null;
}

// "Emma · 3/14 · 6", "Liam · 9/2", "Ava" — one kid as the table shows them.
export function kidLabel(kid, today = new Date()) {
  const parts = [kid.name];
  const date = formatAnnualDate(kid.birthday);
  if (date) {
    const p = date.split('/');
    parts.push(`${p[0]}/${p[1]}`);
    const age = kidAge(kid.birthday, today);
    if (age != null) parts.push(String(age));
  }
  return parts.join(' · ');
}
