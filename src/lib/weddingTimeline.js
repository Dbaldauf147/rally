// The wedding timeline — the plan laid out on real dates.
//
// The checklist says what to do in each stretch ("8–6 months out"); the
// timeline pins each milestone to a day once the wedding has a date, so you can
// see what falls in which month and what is already late. Without a date it
// still reads, by distance from the day ("in 8 weeks").
//
// Every entry is stored as a number of days before the wedding (negative means
// after), not as a calendar date. Moving the wedding moves the whole plan with
// it, which is the one change every couple makes at least once.
//
// The list below is a draft to edit, not the law: it seeds an account that has
// never saved a timeline, and from then on the stored document is the timeline.
//
// Pure: no Firestore, no DOM, so the page and the tests share it.

const DAY_MS = 24 * 60 * 60 * 1000;

const T = (id, daysBefore, title, note = '', milestone = false) => ({ id, daysBefore, title, note, milestone });

export const SEED_ITEMS = [
  // A year or more out — the decisions everything else is priced from.
  T('numbers', 395, 'Agree the budget, a guest-count range and a season', 'Hold back about 10% of the budget as a buffer for overruns.'),
  T('planner', 375, 'Decide on a full planner, or commit to a day-of coordinator', 'At 120–250 guests with two full-time jobs, a planner earns their fee. Sign one before touring venues — they know which ones fit.'),
  T('tour-venues', 360, 'Tour venues — at least four', 'Ask each for their open dates, food & drink minimum, what’s included and the rain plan.'),
  T('venue', 345, 'Book the venue and lock the date', 'Everything else on this timeline counts back from this date.', true),
  T('guest-draft', 335, 'First full draft of the guest list', 'Lives on the Guest List tab. Use tiers A / B / C so cuts are already decided.'),
  T('photographer', 320, 'Book the photographer', 'Good ones book 12+ months ahead, so this goes straight after the venue.'),
  T('caterer', 305, 'Book the caterer (if the venue doesn’t include one)'),
  T('party', 290, 'Ask the wedding party'),
  T('website', 280, 'Put the wedding website up', 'Date, city and hotel info are enough for now — it’s what the save-the-dates point to.'),
  T('music-officiant', 270, 'Book the band or DJ, and the officiant'),
  T('hotels', 255, 'Set up hotel room blocks', 'Two price points near the venue. Check the attrition clause before signing.'),
  T('attire', 245, 'Order the dress / suits', 'Dresses take 4–6 months to arrive, then need about 2 months of alterations.'),
  T('save-the-dates', 225, 'Send save-the-dates', '6–8 months out; 9–12 for a destination or a holiday weekend.', true),
  T('coordinator', 215, 'Book the day-of coordinator (if no full planner)'),
  T('florist-video', 200, 'Book the florist and the videographer'),
  T('registry', 185, 'Set up the registry and add it to the website'),
  T('honeymoon', 175, 'Book the honeymoon and check passports', 'Passports need 6 months of validity for many countries.'),
  T('invitations-order', 155, 'Order the invitations', 'Printing plus addressing takes 6–8 weeks. Collect every mailing address on the Guest List tab now.'),
  T('hair-makeup', 150, 'Book hair and makeup'),
  T('rehearsal-venue', 140, 'Book the rehearsal dinner venue'),
  T('cake-rentals', 125, 'Order the cake; book rentals and transport'),
  T('tasting', 110, 'Menu tasting — settle the menu'),
  T('ceremony', 95, 'Plan the ceremony with the officiant', 'Order of service, readings, who walks when.'),
  T('trial', 85, 'Hair and makeup trial'),
  T('rings', 75, 'Order the wedding bands', 'Sizing and engraving can take 4–6 weeks.'),
  T('invitations-mail', 56, 'Mail the invitations', '8 weeks out. Ask for RSVPs 4 weeks before the day.', true),
  T('fitting-1', 45, 'First dress fitting'),
  T('licence', 35, 'Get the marriage licence', 'In New York it’s valid for 60 days and you must wait 24 hours after it’s issued, so 2–5 weeks out is the window. Both of you go, with ID.', true),
  T('rsvp-deadline', 28, 'RSVP deadline — chase anyone who hasn’t answered'),
  T('headcount', 21, 'Final headcount to the caterer; draft the seating chart'),
  T('vows', 16, 'Write vows and toasts'),
  T('fitting-final', 14, 'Final fitting; send the day-of schedule to every vendor'),
  T('payments', 10, 'Final vendor payments; prepare tip envelopes'),
  T('confirm', 7, 'Confirm every vendor’s arrival time; give the wedding party their schedule'),
  T('pack', 4, 'Pack for the honeymoon'),
  T('dropoff', 2, 'Drop décor, favours and the seating chart at the venue'),
  T('rehearsal', 1, 'Rehearsal and rehearsal dinner'),
  T('wedding', 0, 'The wedding', '', true),
  T('thanks-start', -14, 'Start the thank-you notes'),
  T('name-change', -30, 'Name-change paperwork, if either of you is changing it', 'Social Security first, then the licence/ID, then banks and passports.'),
  T('vendor-reviews', -45, 'Review your vendors; return any rentals still out'),
  T('thanks-done', -90, 'Every thank-you note sent', 'Three months after is the outside edge.'),
];

const clean = (v) => String(v ?? '').trim();

export function makeId() {
  return `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// YYYY-MM-DD, or '' for anything that isn't a real calendar date.
export function cleanDate(v) {
  const s = clean(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? s : '';
}

export function normalizeItem(raw) {
  const n = Math.round(Number(raw?.daysBefore));
  return {
    id: clean(raw?.id) || makeId(),
    daysBefore: Number.isFinite(n) ? n : 0,
    title: clean(raw?.title),
    note: clean(raw?.note),
    milestone: Boolean(raw?.milestone),
    done: Boolean(raw?.done),
  };
}

/* Furthest-out first; ties keep the order they were saved in, so two things
   on the same day don't swap places on every reload. */
export function sortItems(items) {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (b.it.daysBefore - a.it.daysBefore) || (a.i - b.i))
    .map(({ it }) => it);
}

export function normalizeTimeline(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : SEED_ITEMS;
  const seen = new Set();
  const out = [];
  for (const r of items) {
    const it = normalizeItem(r);
    if (seen.has(it.id)) it.id = makeId();
    seen.add(it.id);
    out.push(it);
  }
  return { date: cleanDate(raw?.date), items: sortItems(out) };
}

export const seedTimeline = (date = '') => normalizeTimeline({ date, items: SEED_ITEMS });

// The calendar day an item falls on, as YYYY-MM-DD; '' with no wedding date.
export function itemDate(weddingDate, daysBefore) {
  const d = cleanDate(weddingDate);
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day) - daysBefore * DAY_MS).toISOString().slice(0, 10);
}

// Whole days from `today` to `date` (both YYYY-MM-DD); negative once past.
export function daysUntil(date, today) {
  const a = cleanDate(date);
  const b = cleanDate(today);
  if (!a || !b) return null;
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
}

/* "8 months before", "3 weeks before", "The day before", "2 weeks after".

   Rounded the way people talk about it: months past about two months, weeks
   past about two weeks, days inside that. */
export function relativeLabel(daysBefore) {
  const n = Math.abs(daysBefore);
  if (n === 0) return 'Wedding day';
  if (daysBefore === 1) return 'The day before';
  if (daysBefore === -1) return 'The day after';
  const side = daysBefore > 0 ? 'before' : 'after';
  let amount;
  if (n >= 60) { const m = Math.round(n / 30.4); amount = `${m} month${m === 1 ? '' : 's'}`; }
  else if (n >= 14) { const w = Math.round(n / 7); amount = `${w} week${w === 1 ? '' : 's'}`; }
  else amount = `${n} days`;
  return `${amount} ${side}`;
}

/* The editor's "when" control is an amount, a unit and a side. Turned back
   into days on save; shown from days by picking the unit the amount divides
   into exactly, so 56 days reads "8 weeks" and 45 reads "45 days". */
export const UNIT_DAYS = { days: 1, weeks: 7, months: 30 };

export function splitDays(daysBefore) {
  const n = Math.abs(daysBefore);
  const side = daysBefore < 0 ? 'after' : 'before';
  if (n !== 0 && n % 30 === 0) return { amount: n / 30, unit: 'months', side };
  if (n !== 0 && n % 7 === 0) return { amount: n / 7, unit: 'weeks', side };
  return { amount: n, unit: 'days', side };
}

export function joinDays({ amount, unit, side }) {
  const a = Math.max(0, Math.round(Number(amount) || 0));
  const days = a * (UNIT_DAYS[unit] || 1);
  return side === 'after' ? -days : days;
}

/* The items grouped under month headings ("March 2027"), in order. With no
   wedding date there are no months, so it's one group with no heading. */
export function groupByMonth(timeline) {
  const { date, items } = timeline;
  if (!cleanDate(date)) return [{ key: 'all', label: '', items }];
  const groups = [];
  for (const it of items) {
    const d = itemDate(date, it.daysBefore);
    const key = d.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      const [y, m] = key.split('-').map(Number);
      const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      g = { key, label, items: [] };
      groups.push(g);
    }
    g.items.push(it);
  }
  return groups;
}

// The first thing not yet done, in date order — what to look at next.
export function nextItem(timeline) {
  return timeline.items.find((it) => !it.done) || null;
}

// Not done, and its day has already gone by.
export function isOverdue(timeline, item, today) {
  if (item.done) return false;
  const left = daysUntil(itemDate(timeline.date, item.daysBefore), today);
  return left !== null && left < 0;
}

export function addItem(timeline, patch = {}) {
  return normalizeTimeline({ ...timeline, items: [...timeline.items, normalizeItem({ daysBefore: 30, ...patch, id: makeId() })] });
}

export function updateItem(timeline, id, patch) {
  return normalizeTimeline({ ...timeline, items: timeline.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
}

export function removeItem(timeline, id) {
  return { ...timeline, items: timeline.items.filter((it) => it.id !== id) };
}

export function setDate(timeline, date) {
  return { ...timeline, date: cleanDate(date) };
}

// Today in the viewer's own calendar, as YYYY-MM-DD.
export function localToday(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
