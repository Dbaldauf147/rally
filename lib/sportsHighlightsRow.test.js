// The digest side of highlights: how far back scores reach for a given send
// frequency, and the watch-this line underneath a final score.
import { describe, it, expect } from 'vitest';
import { resultWindowDays, highlightsLinks, resultsTable } from '../api/sports-digest.js';

const game = (highlights) => ({
  iso: '2026-09-19T01:40Z',
  competitors: [
    { name: 'New York Yankees', abbrev: 'NYY', home: false, score: '9', winner: true },
    { name: 'Arizona Diamondbacks', abbrev: 'ARI', home: true, score: '2', winner: false },
  ],
  highlights,
});

describe('resultWindowDays', () => {
  it('covers the week a weekly or monthly digest reports on', () => {
    expect(resultWindowDays('weekly')).toBe(7);
    expect(resultWindowDays('monthly')).toBe(7);
  });

  it('keeps the daily digest at three days, legacy configs included', () => {
    expect(resultWindowDays('daily')).toBe(3);
    expect(resultWindowDays(undefined)).toBe(3);
  });
});

describe('highlightsLinks', () => {
  it('labels the reel by what it is, with its runtime', () => {
    const html = highlightsLinks([
      { kind: 'reel', title: 'Yankees vs. Diamondbacks: Game Highlights', href: 'https://espn.com/a', duration: 57 },
    ]);
    expect(html).toContain('href="https://espn.com/a"');
    expect(html).toContain('Game highlights');
    expect(html).toContain('0:57');
    expect(html).not.toContain('Diamondbacks');
  });

  it('names each play and escapes what ESPN wrote', () => {
    const html = highlightsLinks([
      { kind: 'play', title: 'Wells & Rice go deep', href: 'https://espn.com/a', duration: 34 },
      { kind: 'play', title: "D-backs' walk-off", href: 'https://espn.com/b', duration: 45 },
    ]);
    expect(html).toContain('Wells &amp; Rice go deep');
    expect(html).toContain('D-backs&#39; walk-off');
    expect(html).toContain('0:34');
    expect(html).toContain('0:45');
  });

  it('renders nothing when the game has no usable video', () => {
    expect(highlightsLinks([])).toBe('');
    expect(highlightsLinks(undefined)).toBe('');
  });
});

describe('resultsTable', () => {
  it('hangs the links on a third row, with the date column spanning it', () => {
    const html = resultsTable([game([{ kind: 'reel', title: 'x', href: 'https://espn.com/a', duration: 57 }])], 'America/New_York');
    expect(html).toContain('rowspan="3"');
    expect(html).toContain('colspan="2"');
    expect(html).toContain('Game highlights');
  });

  it('leaves a game with no video exactly as it was', () => {
    const html = resultsTable([game([])], 'America/New_York');
    expect(html).toContain('rowspan="2"');
    expect(html).not.toContain('colspan="2"');
  });
});
