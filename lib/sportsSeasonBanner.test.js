// The banner that says a season is starting. Everything else in the digest is
// a status you scan; this is the one line that is news, so it has to appear in
// the right week and not for the two months either side of it.
import { describe, it, expect } from 'vitest';
import { seasonOpeners, buildSeasonBanner } from '../api/sports-digest.js';

const day = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 8, 7, 12); // a fixed "today" so these can't rot
const iso = (offsetDays) => new Date(now + offsetDays * day).toISOString();

// Phases in the shape espnSeason.js hands back: sorted by start date, with the
// draft merged in among them.
const league = (label, openerOffset, extra = {}) => ({
  label,
  season: {
    year: 2026,
    displayName: '2026',
    startDate: iso(openerOffset - 30),
    endDate: iso(openerOffset + 160),
    phases: [
      { name: 'Draft', startDate: iso(openerOffset - 120), endDate: iso(openerOffset - 118) },
      { name: 'Preseason', startDate: iso(openerOffset - 30), endDate: iso(openerOffset - 1) },
      { name: 'Regular Season', startDate: iso(openerOffset), endDate: iso(openerOffset + 120) },
      { name: 'Postseason', startDate: iso(openerOffset + 121), endDate: iso(openerOffset + 160) },
    ],
    ...extra,
  },
});

const at = (leagues, opts) => seasonOpeners(leagues, { now, ...opts });

describe('seasonOpeners', () => {
  it('announces a season about to start', () => {
    const [o] = at([league('NFL', 3)]);
    expect(o).toMatchObject({ label: 'NFL', name: 'Regular Season', days: 3, started: false });
  });

  it('still announces one that started since the last digest', () => {
    const [o] = at([league('NFL', -4)]);
    expect(o).toMatchObject({ label: 'NFL', days: -4, started: true });
  });

  it('says nothing for a season that is well under way', () => {
    expect(at([league('NFL', -40)])).toEqual([]);
  });

  it('says nothing for one still months out', () => {
    expect(at([league('NBA', 45)])).toEqual([]);
  });

  it('counts the opener as started on the day itself', () => {
    const [o] = at([league('NFL', 0)]);
    expect(o).toMatchObject({ days: 0, started: true });
  });

  // The draft sits in the phase list ahead of the regular season, so picking
  // "first phase that isn't an exhibition" naively would call the draft the
  // start of the season — in April.
  it('does not mistake the draft for the start of the season', () => {
    const [o] = at([league('NFL', 3)]);
    expect(o.name).toBe('Regular Season');
  });

  it('does not mistake the preseason for the start of the season', () => {
    // The exhibitions opened three days ago; the season itself is a month out.
    expect(at([league('NFL', 30)])).toEqual([]);
  });

  it('falls back to the season window when ESPN has no phases', () => {
    const bare = { label: 'MLS', season: { year: 2026, startDate: iso(2), endDate: iso(200), phases: [] } };
    const [o] = at([bare]);
    expect(o).toMatchObject({ label: 'MLS', name: 'Season', days: 2 });
  });

  it('leaves out a league ESPN has no season for at all', () => {
    expect(at([{ label: 'Nothing', season: null }])).toEqual([]);
    expect(at([{ label: 'Undated', season: { phases: [{ name: 'Regular Season' }] } }])).toEqual([]);
  });

  it('lists several leagues, soonest first', () => {
    const out = at([league('NBA', 5), league('NFL', -2), league('NHL', 1)]);
    expect(out.map((o) => o.label)).toEqual(['NFL', 'NHL', 'NBA']);
  });

  it('handles no leagues at all', () => {
    expect(seasonOpeners([], { now })).toEqual([]);
    expect(seasonOpeners(null, { now })).toEqual([]);
  });

  // A weekly reader only sees one day in seven. A one-day memory would mean a
  // Thursday kickoff was never mentioned to somebody who reads on Sundays.
  describe('the lookback window matches how often the digest goes out', () => {
    it('a daily reader is told the day after', () => {
      expect(at([league('NFL', -1)], { lookbackDays: 2 })).toHaveLength(1);
      expect(at([league('NFL', -5)], { lookbackDays: 2 })).toEqual([]);
    });

    it('a weekly reader is still told six days later', () => {
      expect(at([league('NFL', -6)], { lookbackDays: 8 })).toHaveLength(1);
    });

    it('a monthly reader is still told three weeks later', () => {
      expect(at([league('NFL', -21)], { lookbackDays: 31 })).toHaveLength(1);
    });
  });
});

describe('buildSeasonBanner', () => {
  const tz = 'America/New_York';
  const opener = (over = {}) => ({
    label: 'NFL', name: 'Regular Season', startDate: '2026-09-10T20:20:00Z', days: 3, started: false, ...over,
  });

  it('renders nothing when no season is turning over', () => {
    expect(buildSeasonBanner([], tz)).toBe('');
    expect(buildSeasonBanner(null, tz)).toBe('');
  });

  it('names the league, the phase and the date', () => {
    const html = buildSeasonBanner([opener()], tz);
    expect(html).toContain('NFL');
    expect(html).toContain('Regular Season');
    expect(html).toContain('Sep 10, 2026');
  });

  it('reads as a countdown before, and as news after', () => {
    expect(buildSeasonBanner([opener()], tz)).toContain('A new season starts');
    expect(buildSeasonBanner([opener({ started: true, days: -2 })], tz))
      .toContain('A new season has started');
  });

  it('says today and tomorrow rather than printing the date', () => {
    expect(buildSeasonBanner([opener({ days: 1 })], tz)).toContain('starts tomorrow');
    expect(buildSeasonBanner([opener({ days: 0, started: true })], tz)).toContain('started today');
  });

  it('pluralises the heading for more than one league', () => {
    const html = buildSeasonBanner([opener(), opener({ label: 'NHL' })], tz);
    expect(html).toContain('New seasons');
    expect(html).toContain('NHL');
  });

  // Email clients strip <style> and much else; the banner has to survive as
  // inline styles on a table, like the rest of this email.
  it('is inline-styled table markup, not a class', () => {
    const html = buildSeasonBanner([opener()], tz);
    expect(html).toContain('<table');
    expect(html).toMatch(/style="[^"]*background:#fef3c7/);
    expect(html).not.toContain('class=');
  });
});
