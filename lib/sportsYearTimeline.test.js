// The digest's season block is a year-long chart now, so its correctness is
// arithmetic: where a bar starts, where it stops, and where today falls. These
// pin the window and the spans against a fixed date, since a chart of "the next
// twelve months" is otherwise a test that quietly changes answer every month.
import { describe, it, expect, vi } from 'vitest';
import { seasonYearSpans, buildSeasonBlock } from '../api/sports-digest.js';

// 20 Sep 2026. The window runs from two months back, so Jul 2026 – Jun 2027.
const NOW = Date.UTC(2026, 8, 20, 16);
const spans = (leagues) => seasonYearSpans(leagues, { now: NOW });

const phase = (name, startDate, endDate) => ({ name, startDate, endDate });

// In the shape espnSeason.js hands back: phases sorted by start date.
const nfl = {
  label: 'NFL',
  season: {
    year: 2026,
    startDate: '2026-08-01T07:00:00Z',
    endDate: '2027-02-16T07:00:00Z',
    phases: [
      phase('Draft', '2026-04-23T23:00:00Z', '2026-04-25T23:00:00Z'),
      phase('Preseason', '2026-08-01T07:00:00Z', '2026-09-08T06:59:00Z'),
      phase('Regular Season', '2026-09-09T07:00:00Z', '2027-01-13T07:59:00Z'),
      phase('Postseason', '2027-01-14T08:00:00Z', '2027-02-16T07:00:00Z'),
      phase('Off Season', '2027-02-17T08:00:00Z', '2027-07-31T07:00:00Z'),
    ],
  },
};

// Started in March, so its bar is already running when the window opens.
const mlb = {
  label: 'MLB',
  season: {
    year: 2026,
    startDate: '2026-02-20T08:00:00Z',
    endDate: '2026-11-12T08:00:00Z',
    phases: [
      phase('Spring Training', '2026-02-20T08:00:00Z', '2026-03-25T07:00:00Z'),
      phase('Regular Season', '2026-03-26T07:00:00Z', '2026-09-29T07:00:00Z'),
      phase('Postseason', '2026-09-30T07:00:00Z', '2026-11-12T08:00:00Z'),
    ],
  },
};

// Dark today: ESPN still reports the season that finished in June, with an off
// season running to the day the next one opens.
const nba = {
  label: 'NBA',
  season: {
    year: 2026,
    startDate: '2025-10-01T07:00:00Z',
    endDate: '2026-06-22T07:00:00Z',
    phases: [
      phase('Regular Season', '2025-10-21T07:00:00Z', '2026-04-12T07:00:00Z'),
      phase('Postseason', '2026-04-13T07:00:00Z', '2026-06-22T07:00:00Z'),
      phase('Off Season', '2026-06-23T07:00:00Z', '2026-10-19T07:00:00Z'),
    ],
  },
};

const kinds = (row) => row.segments.map((s) => s.kind);
const row = (chart, label) => chart.rows.find((r) => r.label === label);

describe('seasonYearSpans', () => {
  it('opens the window two months back so autumn leagues fit whole', () => {
    const chart = spans([nfl]);
    expect(chart.start).toBe(Date.UTC(2026, 6, 1));
    expect(chart.end).toBe(Date.UTC(2027, 6, 1));
    expect(chart.months).toHaveLength(12);
    expect(chart.months[0]).toMatchObject({ label: 'Jul', year: 2026 });
    expect(chart.months[11]).toMatchObject({ label: 'Jun', year: 2027 });
  });

  // A calendar year would cut the NFL in half — the whole reason the window
  // isn't January to December.
  it('keeps a season that runs into the next January in one piece', () => {
    const nflRow = row(spans([nfl]), 'NFL');
    const last = nflRow.segments[nflRow.segments.length - 1];
    expect(last.kind).toBe('regular');
    const jan13 = ((Date.UTC(2027, 0, 13, 7, 59) - Date.UTC(2026, 6, 1)) / (Date.UTC(2027, 6, 1) - Date.UTC(2026, 6, 1))) * 100;
    expect(last.end).toBeCloseTo(jan13, 5);
  });

  // The chart is the regular season; the bars either side of it were noise.
  it('leaves out the preseason and the postseason', () => {
    const playIn = { label: 'NBA', season: { phases: [
      phase('Regular Season', '2026-10-20T07:00:00Z', '2027-04-12T07:00:00Z'),
      phase('Play-In Season', '2027-04-12T07:00:00Z', '2027-04-17T07:00:00Z'),
      phase('Postseason', '2027-04-17T07:00:00Z', '2027-06-26T07:00:00Z'),
    ] } };
    for (const r of spans([nfl, mlb, playIn]).rows) {
      expect(kinds(r)).not.toContain('pre');
      expect(kinds(r)).not.toContain('post');
    }
    expect(kinds(row(spans([playIn]), 'NBA'))).toEqual(['regular']);
  });

  it('puts today where today is, and splits every bar there', () => {
    const chart = spans([nfl, mlb]);
    expect(chart.nowPct).toBeCloseTo(22.4, 0);
    // The regular season is one phase drawn as two: played, then to come.
    const played = row(chart, 'NFL').segments.filter((s) => s.kind === 'regular' && s.behind);
    const toCome = row(chart, 'NFL').segments.filter((s) => s.kind === 'regular' && !s.behind);
    expect(played).toHaveLength(1);
    expect(toCome).toHaveLength(1);
    expect(played[0].end).toBeCloseTo(chart.nowPct, 5);
    expect(toCome[0].start).toBeCloseTo(chart.nowPct, 5);
  });

  it('clamps a season already under way to the left edge', () => {
    const mlbRow = row(spans([mlb]), 'MLB');
    expect(mlbRow.segments[0]).toMatchObject({ kind: 'regular', start: 0, behind: true });
    // Spring training ended in March, before the window: nothing to draw.
    expect(kinds(mlbRow)).not.toContain('pre');
  });

  it('gives the months their real widths, adding up to the track', () => {
    const chart = spans([nfl]);
    const total = chart.months.reduce((sum, m) => sum + m.width, 0);
    expect(total).toBeCloseTo(100, 6);
    const feb = chart.months.find((m) => m.label === 'Feb');
    const jan = chart.months.find((m) => m.label === 'Jan');
    expect(feb.width).toBeLessThan(jan.width); // 28 days against 31
  });

  // The draft is one day. At a year's width that's thinner than the line it
  // would be drawn with, and it has the banner and the draft block already.
  it('leaves the draft out', () => {
    expect(kinds(row(spans([nfl]), 'NFL'))).not.toContain(null);
    expect(row(spans([nfl]), 'NFL').segments.every((s) => s.kind !== 'draft')).toBe(true);
    expect(kinds(row(spans([nfl]), 'NFL'))).toEqual(['regular', 'regular']);
  });

  /* An off season is the gap between two bars, so drawing every one of them
     would double the ink. The one a league is sitting in right now is the
     exception: without it a dark league gets a blank row. */
  it('draws the off season a league is in now, and ends it where it ends', () => {
    const chart = spans([nba]);
    const nbaRow = row(chart, 'NBA');
    expect(kinds(nbaRow)).toEqual(['off', 'off']);
    const opensAt = ((Date.UTC(2026, 9, 19, 7) - chart.start) / (chart.end - chart.start)) * 100;
    expect(nbaRow.segments[1].end).toBeCloseTo(opensAt, 5);
  });

  it('leaves out an off season the league is not in', () => {
    // The NFL's runs from February; it is nine months from being relevant.
    expect(kinds(row(spans([nfl]), 'NFL'))).not.toContain('off');
  });

  it('runs top to bottom in the order the leagues start playing', () => {
    expect(spans([nba, nfl, mlb]).rows.map((r) => r.label)).toEqual(['MLB', 'NFL', 'NBA']);
  });

  it('draws a league with no phase breakdown as one season-long bar', () => {
    const bare = { label: 'MLS', season: { startDate: '2026-08-15T07:00:00Z', endDate: '2026-12-06T07:00:00Z', phases: [] } };
    expect(kinds(row(spans([bare]), 'MLS'))).toEqual(['regular', 'regular']);
  });

  // A league that vanishes from the chart reads as one you no longer follow.
  it('keeps a league with nothing in the window, as an empty track', () => {
    const gone = { label: 'Nothing', season: null };
    const chart = spans([nfl, gone]);
    expect(chart.rows.map((r) => r.label)).toEqual(['NFL', 'Nothing']);
    expect(row(chart, 'Nothing').segments).toEqual([]);
  });

  it('trims phases ESPN hands back overlapping, so a row still adds up', () => {
    const sloppy = {
      label: 'Sloppy',
      season: {
        startDate: '2026-08-01T07:00:00Z',
        endDate: '2026-12-01T07:00:00Z',
        phases: [
          phase('Regular Season', '2026-08-01T07:00:00Z', '2026-11-01T07:00:00Z'),
          phase('Postseason', '2026-10-25T07:00:00Z', '2026-12-01T07:00:00Z'),
        ],
      },
    };
    const segments = row(spans([sloppy]), 'Sloppy').segments;
    for (let i = 1; i < segments.length; i += 1) {
      expect(segments[i].start).toBeGreaterThanOrEqual(segments[i - 1].end);
    }
  });

  it('handles no leagues at all', () => {
    expect(spans([]).rows).toEqual([]);
    expect(spans(null).rows).toEqual([]);
  });
});

describe('buildSeasonBlock', () => {
  const tz = 'America/New_York';

  it('renders nothing without leagues', () => {
    expect(buildSeasonBlock([], tz)).toBe('');
    expect(buildSeasonBlock(null, tz)).toBe('');
  });

  it('keeps the dates beside the bar a league still needs them for', () => {
    const html = buildSeasonBlock([nfl, nba], tz, NOW);
    expect(html).toContain('Regular Season through');
    expect(html).toContain('Jan 13, 2027');
    expect(html).toContain('Season starts Oct 19, 2026');
    expect(html).not.toContain('In season');
  });

  it('says nothing about a postseason, even one under way', () => {
    // 15 Oct 2026: MLB is in its playoffs. The status line reads the clock itself.
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 15, 16) });
    try {
      const html = buildSeasonBlock([mlb, nfl], tz, Date.now());
      expect(html).not.toMatch(/postseason|preseason/i);
      expect(html).toContain('Regular season ended Sep 29, 2026');
      // Counted to the regular season's end, Jan 13 — not the Super Bowl.
      expect(html).toContain('90 days left');
    } finally {
      vi.useRealTimers();
    }
  });

  it('labels the year the chart covers', () => {
    expect(buildSeasonBlock([nfl], tz, NOW)).toContain('Jul 2026 – Jun 2027');
  });

  it('marks today over the track', () => {
    expect(buildSeasonBlock([nfl], tz, NOW)).toContain('Today');
  });

  // Email clients strip <style> and much else, so the chart has to survive as
  // background colours on table cells — there is no other way to draw a bar.
  it('is inline-styled table markup, not a class or an image', () => {
    const html = buildSeasonBlock([nfl], tz, NOW);
    expect(html).toContain('<table');
    expect(html).toMatch(/background:#4f46e5/);
    expect(html).not.toContain('class=');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<svg');
  });

  it('keys only the tones it actually drew', () => {
    expect(buildSeasonBlock([nfl], tz, NOW)).not.toContain('Between seasons');
    expect(buildSeasonBlock([nfl, nba], tz, NOW)).toContain('Between seasons');
  });

  it('gives every league a row, in season or not', () => {
    const html = buildSeasonBlock([nfl, mlb, nba], tz, NOW);
    for (const label of ['NFL', 'MLB', 'NBA']) expect(html).toContain(`>${label}</div>`);
  });
});
