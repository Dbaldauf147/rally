// The weekly digest's league table used to print all thirty-odd clubs. It now
// prints the top ten, keeps the followed team's real place when it sits below
// them, and puts that place beside the team's name.
import { describe, it, expect } from 'vitest';
import { leagueTopRows, leagueRank, buildSeasonBlock } from '../api/sports-digest.js';

const rows = Array.from({ length: 30 }, (_, i) => ({ id: String(100 + i), name: `Club ${i + 1}`, rank: i + 1 }));

describe('leagueTopRows', () => {
  it('keeps only the top ten when the team is among them', () => {
    const out = leagueTopRows(rows, '103');
    expect(out.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('adds the team underneath, with its real rank, when it sits below the cut', () => {
    const out = leagueTopRows(rows, 116);
    expect(out).toHaveLength(11);
    expect(out[10]).toMatchObject({ id: '116', rank: 17 });
  });

  it('leaves a short league alone', () => {
    expect(leagueTopRows(rows.slice(0, 6), '101')).toHaveLength(6);
  });
});

describe('leagueRank', () => {
  it('reads the place out of the whole-league table', () => {
    expect(leagueRank({ national: { rows } }, 116)).toEqual({ rank: 17, of: 30 });
  });

  it('is null without a league table or when the team is not in it', () => {
    expect(leagueRank({ division: { rows } }, '116')).toBeNull();
    expect(leagueRank({ national: { rows } }, '999')).toBeNull();
    expect(leagueRank(null, '116')).toBeNull();
  });
});

describe('buildSeasonBlock', () => {
  const day = 86400000;
  const iso = (d) => new Date(Date.now() + d * day).toISOString();

  it('is one line per league, with no "In season" preamble', () => {
    const html = buildSeasonBlock([{
      label: 'MLB',
      season: {
        displayName: '2026', startDate: iso(-200), endDate: iso(60),
        phases: [{ name: 'Regular Season', startDate: iso(-169), endDate: iso(16) }],
      },
    }], 'America/New_York');
    expect((html.match(/<tr>/g) || [])).toHaveLength(1);
    expect(html).toContain('Regular Season through');
    expect(html).toMatch(/\d+ days left/);
    expect(html).not.toContain('In season');
  });
});
