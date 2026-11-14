import { describe, it, expect } from 'vitest';
import { showsTripPlanning, hasItineraryContent } from './eventPlanning';

const none = { itinerary: false, travel: false, lodging: false };

describe('showsTripPlanning', () => {
  it('hides the trip parts when nothing needs planning and nothing is there', () => {
    expect(showsTripPlanning({ title: 'Secret Santa', planning: none })).toBe(false);
    expect(showsTripPlanning({ planning: {} })).toBe(false);
  });
  it('shows them when any planning box is ticked', () => {
    for (const k of ['itinerary', 'travel', 'lodging']) {
      expect(showsTripPlanning({ planning: { ...none, [k]: true } })).toBe(true);
    }
  });
  it('leaves events from before the question existed alone', () => {
    expect(showsTripPlanning({ title: 'Old trip' })).toBe(true);
    expect(showsTripPlanning({ planning: null })).toBe(true);
  });
  it('never hides an itinerary that has something in it', () => {
    expect(showsTripPlanning({ planning: none, itinerary: [{ id: 'a' }] })).toBe(true);
    expect(showsTripPlanning({ planning: none, tripHighlights: [{ id: 'h' }] })).toBe(true);
    expect(showsTripPlanning({ planning: none, flightCosts: [{ id: 'f' }] })).toBe(true);
    expect(showsTripPlanning({ planning: none, dailyNames: { '2026-10-31': 'Party' } })).toBe(true);
    expect(showsTripPlanning({ planning: none, dailyBullets: { '2026-10-31': ['Pumpkins'] } })).toBe(true);
    expect(showsTripPlanning({ planning: none, itineraryComplete: true })).toBe(true);
    expect(showsTripPlanning({ planning: none, travelBooked: true })).toBe(true);
  });
  it('does not count empty leftovers as content', () => {
    expect(hasItineraryContent({ itinerary: [], tripHighlights: [], dailyNames: { '2026-10-31': '  ' }, dailyBullets: { '2026-10-31': [] }, itineraryComplete: false })).toBe(false);
    expect(showsTripPlanning(null)).toBe(false);
  });
});
