// The Boat Day data model, kept out of the component so both EventDetail and the
// public boat page can read it without importing the view.
//
// An event's boat days live at `event.boatDay.days`:
//   [{ date: 'YYYY-MM-DD', roster: [...], responses: [...], orders: { <nameKey>: {...} } }]
// Each day carries its own seating and its own deli order.

const pad2 = n => String(n).padStart(2, '0');

// 'YYYY-MM-DD' in local time, matching how the rest of the app keys days.
// Accepts a Firestore Timestamp, a Date, or a date string.
export function dateKeyOf(value) {
  const d = value?.toDate?.() || (value ? new Date(value) : null);
  if (!d || isNaN(d)) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function normalizeDay(d) {
  return {
    date: d?.date || '',
    roster: Array.isArray(d?.roster) ? d.roster : [],
    responses: Array.isArray(d?.responses) ? d.responses : [],
    orders: d?.orders && typeof d.orders === 'object' ? d.orders : {},
  };
}

/**
 * The event's boat days, in date order. Events from before Boat Day went
 * multi-day carry a single flat roster/responses pair; those fold into one day
 * on the event's own date. The migration is lazy — nothing is rewritten until
 * someone actually changes something, so merely opening the public link never
 * writes.
 */
export function boatDays(boat, fallbackDateKey) {
  const stored = Array.isArray(boat?.days) ? boat.days : null;
  if (stored && stored.length) {
    return stored.map(normalizeDay).sort((a, b) => a.date.localeCompare(b.date));
  }
  const legacy = normalizeDay({ date: fallbackDateKey, roster: boat?.roster, responses: boat?.responses });
  return (legacy.roster.length || legacy.responses.length || fallbackDateKey) ? [legacy] : [];
}

// Everyone aboard on any day, once each — what "who's coming on the boat" means
// for the owner's summary count and the add-to-poll import.
export function boatRosterUnion(boat, fallbackDateKey) {
  const seen = new Set();
  const out = [];
  for (const d of boatDays(boat, fallbackDateKey)) {
    for (const p of d.roster) {
      const k = (p.name || '').trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}

export function fmtDayLabel(key) {
  const d = new Date(`${key}T12:00:00`);
  if (isNaN(d)) return key || '';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Which day to show on arrival: today if the boat is out today, else the next
// one coming up, else the most recent.
export function defaultDay(days) {
  if (!days.length) return '';
  const today = dateKeyOf(new Date());
  return (days.find(d => d.date === today) || days.find(d => d.date >= today) || days[days.length - 1]).date;
}

// Orders are keyed by name, the same identity the roster dedups on, so an order
// survives someone being moved between boats.
export const orderKeyOf = name => (name || '').trim().toLowerCase();
