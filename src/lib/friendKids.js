// A friend's kids, kept on the friend doc as `kids: [{ name, birthday }]`.
//
// The birthday is stored the way an anniversary is (lib/looseDate.js):
// YYYY-MM-DD when the year is known, MM-DD when it isn't — a kid's birthday is
// often remembered as "the 14th of March" long before anyone knows the year,
// and the year, when there is one, is what puts an age next to the name.
import { normalizeAnnualDate, formatAnnualDate, annualDateInfo, parseLooseDate, validParts, yearsSince } from './looseDate';

// A kid's photo for the family tree rides on the kid, as the id of a picture in
// users/{uid}/familyPhotos (lib/familyPhotos.js). Carried through untouched.
const withPhoto = (k, row) => (k?.photoId ? { ...row, photoId: String(k.photoId) } : row);

// For the editor: dates in the short form people type, never an empty list.
export function kidsForEditing(kids) {
  const rows = (Array.isArray(kids) ? kids : [])
    .filter((k) => k && typeof k === 'object')
    .map((k) => withPhoto(k, { name: String(k.name || ''), birthday: formatAnnualDate(k.birthday) || String(k.birthday || '') }));
  return rows.length > 0 ? rows : [{ name: '', birthday: '' }];
}

// For the doc: rows without a name are dropped (a birthday alone names no
// one), and a date that won't parse is cleared rather than stored half-read.
export function kidsForSaving(kids) {
  return (Array.isArray(kids) ? kids : [])
    .map((k) => withPhoto(k, { name: String(k?.name || '').trim(), birthday: normalizeAnnualDate(k?.birthday) }))
    .filter((k) => k.name);
}

// Age today, from a birthday that carries its year. Null without one.
export function kidAge(birthday, today = new Date()) {
  const age = yearsSince(birthday, today);
  return age != null && age < 120 ? age : null;
}

// The age beside a kid's birthday in the editor: "Age 7", or months for a
// baby ("5 mo", "Newborn"). Empty without a birth year, or before the date.
export function kidAgeLabel(birthday, today = new Date()) {
  const age = kidAge(birthday, today);
  if (age == null) return '';
  if (age > 0) return `Age ${age}`;
  const p = parseLooseDate(birthday);
  if (!validParts(p) || !p.year) return '';
  let months = (today.getFullYear() - p.year) * 12 + (today.getMonth() + 1 - p.month);
  if (today.getDate() < p.day) months -= 1;
  return months <= 0 ? 'Newborn' : `${months} mo`;
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

// The kids whose birthday is today, each with the age they turn — null when
// the year was never recorded. Reach Out's "kid's birthday" card is built on
// this.
export function kidsWithBirthdayToday(kids, today = new Date()) {
  return (Array.isArray(kids) ? kids : [])
    .filter((k) => k?.name)
    .map((k) => ({ name: k.name, info: annualDateInfo(k.birthday, today) }))
    .filter((k) => k.info?.isToday)
    .map((k) => ({ name: k.name, turns: k.info.year ? k.info.years : null }));
}

// "Emma turns 7 today", or just "Emma's birthday is today" without a year.
export function kidBirthdayLine(kid) {
  return kid.turns != null && kid.turns > 0 ? `${kid.name} turns ${kid.turns} today` : `${kid.name}'s birthday is today`;
}
