// Whether an event's page shows its trip-planning parts: the Itinerary tab,
// and the "Itinerary Completed" / "Travel Booked" steps and buttons.
//
// The edit form asks "What needs planning?" (Itinerary / Travel / Lodging) and
// stores the answer as `planning`. A dinner, a birthday or a yearly Secret
// Santa ticks none of them, and shouldn't open onto an empty trip itinerary.
//
// Hiding is the cautious direction, so it only happens when it's certain
// nothing is lost:
//   • an event from before the question existed has no `planning` — it keeps
//     everything, as it always has;
//   • an event with anything already in its itinerary, or already marked
//     complete or booked, keeps everything whatever is ticked.
// Ticking a box in Edit Event brings it all back.
//
// Pure: no Firestore, no DOM.

const PLANNING_KEYS = ['itinerary', 'travel', 'lodging'];

// Lists the itinerary keeps on the event.
const LIST_FIELDS = ['itinerary', 'tripHighlights', 'flightCosts', 'bookedDayKeys'];
// Per-day maps: day key → name / destination / bullet text.
const MAP_FIELDS = ['dailyNames', 'dailyDestinations', 'dailyBullets'];

const hasText = (v) => {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.some(hasText);
  if (typeof v === 'object') return Object.values(v).some(hasText);
  return true;
};

/** True when something has been put in the event's itinerary. */
export function hasItineraryContent(event) {
  if (!event) return false;
  if (event.itineraryComplete || event.travelBooked) return true;
  if (LIST_FIELDS.some((f) => Array.isArray(event[f]) && event[f].length > 0)) return true;
  return MAP_FIELDS.some((f) => hasText(event[f]));
}

/** True when the event page should show its trip-planning parts. */
export function showsTripPlanning(event) {
  if (!event) return false;
  const planning = event.planning;
  if (!planning || typeof planning !== 'object') return true;
  if (PLANNING_KEYS.some((k) => !!planning[k])) return true;
  return hasItineraryContent(event);
}
