// Which leagues the digest treats as in season. ESPN's season window spans
// preseason through the offseason, so the window alone let the Knicks in during
// exhibitions; the current phase decides instead.
import { describe, it, expect } from 'vitest';
import { isSeasonActive } from '../api/sports-digest.js';

const day = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 19);
const iso = (offsetDays) => new Date(now + offsetDays * day).toISOString();

const withPhase = (name) => ({
  startDate: iso(-100),
  endDate: iso(200),
  phases: [{ name, startDate: iso(-5), endDate: iso(5) }],
});

describe('isSeasonActive', () => {
  it('counts the regular season and postseason', () => {
    expect(isSeasonActive(withPhase('Regular Season'), now)).toBe(true);
    expect(isSeasonActive(withPhase('Postseason'), now)).toBe(true);
  });

  it('does not count preseason, spring training, the offseason or the draft', () => {
    for (const name of ['Preseason', 'Spring Training', 'Off Season', 'Draft']) {
      expect(isSeasonActive(withPhase(name), now)).toBe(false);
    }
  });

  it('falls back to the season window when no phase covers today', () => {
    const gap = { startDate: iso(-10), endDate: iso(10), phases: [{ name: 'Regular Season', startDate: iso(20), endDate: iso(90) }] };
    expect(isSeasonActive(gap, now)).toBe(true);
    expect(isSeasonActive({ ...gap, endDate: iso(-1) }, now)).toBe(false);
  });

  it('treats unknown dates as in season', () => {
    expect(isSeasonActive(null, now)).toBe(true);
  });
});
