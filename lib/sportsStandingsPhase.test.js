// Regression cover for the preseason standings bug: the weekly digest printed
// NFL exhibition records (3-0, 2-1) as a league table a week before the regular
// season started. Scores and the season status line already excluded
// exhibitions; standings did not.
import { describe, it, expect } from 'vitest';
import { standingsHeldUntil } from '../api/sports-digest.js';

// Phases as ESPN ships them, relative to "now" so the tests don't rot.
const day = 24 * 60 * 60 * 1000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString();

const nflNow = {
  year: 2026,
  phases: [
    { name: 'Draft', startDate: iso(-120), endDate: iso(-118) },
    { name: 'Preseason', startDate: iso(-25), endDate: iso(6) },
    { name: 'Regular Season', startDate: iso(7), endDate: iso(140) },
    { name: 'Postseason', startDate: iso(141), endDate: iso(180) },
    { name: 'Off Season', startDate: iso(181), endDate: iso(300) },
  ],
};

const mlbNow = {
  year: 2026,
  phases: [
    { name: 'Spring Training', startDate: iso(-200), endDate: iso(-170) },
    { name: 'Regular Season', startDate: iso(-169), endDate: iso(30) },
    { name: 'Postseason', startDate: iso(31), endDate: iso(60) },
  ],
};

describe('standingsHeldUntil', () => {
  it('withholds standings during the NFL preseason', () => {
    const held = standingsHeldUntil(nflNow);
    expect(held).toBeTruthy();
    expect(held.name).toBe('Regular Season');
  });

  it('names the date the standings start counting', () => {
    const held = standingsHeldUntil(nflNow);
    expect(new Date(held.startDate).getTime()).toBeGreaterThan(Date.now());
  });

  it('shows standings once the regular season is under way', () => {
    expect(standingsHeldUntil(mlbNow)).toBeNull();
  });

  it("withholds during MLB's spring training too, not just the NFL wording", () => {
    // ESPN labels the exhibition phase differently per league; matching on
    // "Preseason" alone would let Spring Training records through.
    const spring = {
      phases: [
        { name: 'Spring Training', startDate: iso(-5), endDate: iso(10) },
        { name: 'Regular Season', startDate: iso(11), endDate: iso(200) },
      ],
    };
    expect(standingsHeldUntil(spring)?.name).toBe('Regular Season');
  });

  it('shows standings in the postseason', () => {
    const post = {
      phases: [
        { name: 'Regular Season', startDate: iso(-100), endDate: iso(-1) },
        { name: 'Postseason', startDate: iso(0), endDate: iso(30) },
      ],
    };
    expect(standingsHeldUntil(post)).toBeNull();
  });

  it('never skips the regular season in favour of a later phase', () => {
    // The countdown must name the next phase that counts, not the postseason.
    expect(standingsHeldUntil(nflNow).name).not.toBe('Postseason');
  });

  it('still withholds when there is no upcoming phase to name', () => {
    // A missing follow-on phase must not resurrect the exhibition table.
    const stranded = { phases: [{ name: 'Preseason', startDate: iso(-3), endDate: iso(3) }] };
    const held = standingsHeldUntil(stranded);
    expect(held).toBeTruthy();
    expect(held.startDate).toBeNull();
  });

  it('does not withhold when ESPN gives no phases at all', () => {
    expect(standingsHeldUntil({ phases: [] })).toBeNull();
    expect(standingsHeldUntil({})).toBeNull();
    expect(standingsHeldUntil(null)).toBeNull();
  });

  it('does not withhold in a gap between phases', () => {
    const gap = {
      phases: [
        { name: 'Preseason', startDate: iso(-30), endDate: iso(-10) },
        { name: 'Regular Season', startDate: iso(10), endDate: iso(100) },
      ],
    };
    expect(standingsHeldUntil(gap)).toBeNull();
  });
});
