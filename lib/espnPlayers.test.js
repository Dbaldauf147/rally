// Key players for the sports digest: the most important five, minus anyone who
// isn't actually playing.
import { describe, it, expect } from 'vitest';
import { pickKeyPlayers, isPlaying } from './espnPlayers.js';

const leader = (id, displayValue) => ({ displayValue, athlete: { $ref: `http://sports.core.api.espn.com/v2/sports/x/leagues/y/seasons/2026/athletes/${id}?lang=en` } });
const athlete = (id, extra = {}) => [String(id), { id: String(id), displayName: `Player ${id}`, position: { abbreviation: 'P' }, status: { name: 'Active' }, ...extra }];

describe('isPlaying', () => {
  it('keeps active and day-to-day players', () => {
    expect(isPlaying({ status: { name: 'Active' } })).toBe(true);
    expect(isPlaying({ status: { name: 'Day-To-Day' }, injuries: [{ status: 'Questionable' }] })).toBe(true);
  });

  it('drops the injured, the practice squad and anyone not on the roster', () => {
    expect(isPlaying({ status: { name: 'Active' }, injuries: [{ status: 'Out' }] })).toBe(false);
    expect(isPlaying({ status: { name: 'Active' }, injuries: [{ status: 'Injured Reserve' }] })).toBe(false);
    expect(isPlaying({ status: { name: 'Active' }, injuries: [{ status: '10-Day IL' }] })).toBe(false);
    expect(isPlaying({ status: { name: 'Practice Squad' } })).toBe(false);
    expect(isPlaying(undefined)).toBe(false);
  });
});

describe('pickKeyPlayers', () => {
  it('reads baseball straight down WAR, skipping the injured and the departed', () => {
    const categories = [{
      name: 'WARBR', abbreviation: 'WAR', displayName: 'Wins Above Replacement',
      leaders: [leader(1, '4.6'), leader(2, '2.9'), leader(3, '2.2'), leader(4, '1.9'), leader(5, '1.5'), leader(6, '1.3'), leader(7, '1.2')],
    }];
    const roster = new Map([
      athlete(1), athlete(2, { injuries: [{ status: '60-Day IL' }] }), athlete(3), athlete(4), athlete(6), athlete(7),
    ]); // 5 has left the team
    const out = pickKeyPlayers('baseball/mlb', categories, roster);
    expect(out.map((p) => p.id)).toEqual(['1', '3', '4', '6', '7']);
    expect(out[0]).toMatchObject({ name: 'Player 1', stat: '4.6 WAR', role: '' });
  });

  it('takes football by role in turn, never listing one player twice', () => {
    const categories = [
      { name: 'passingLeader', displayName: 'Passing Leader', leaders: [leader(10, '128/204, 1259 YDS, 7 TD')] },
      { name: 'rushingLeader', displayName: 'Rushing Leader', leaders: [leader(10, '80 YDS'), leader(11, '400 YDS')] },
      { name: 'receivingLeader', displayName: 'Receiving Leader', leaders: [leader(12, '36 REC, 395 YDS'), leader(13, '20 REC')] },
      { name: 'totalTackles', displayName: 'Total Tackles', abbreviation: 'TOT', leaders: [leader(14, '52')] },
      { name: 'sacks', displayName: 'Sacks', abbreviation: 'SACK', leaders: [leader(15, '6.5')] },
    ];
    const roster = new Map([10, 11, 12, 13, 14, 15].map((id) => athlete(id)));
    const out = pickKeyPlayers('football/nfl', categories, roster);
    expect(out.map((p) => p.id)).toEqual(['10', '11', '12', '14', '15']);
    expect(out.map((p) => p.role)).toEqual(['Passing Leader', 'Rushing Leader', 'Receiving Leader', 'Total Tackles', 'Sacks']);
    expect(out[3].stat).toBe('52 TOT');
    expect(out[0].stat).toBe('128/204, 1259 YDS, 7 TD');
  });

  it('leaves the passing slot to a quarterback, not a trick-play thrower', () => {
    const categories = [
      { name: 'passingLeader', displayName: 'Passing Leader', leaders: [leader(30, '1/1, 4 YDS, 1 TD')] },
      { name: 'rushingLeader', displayName: 'Rushing Leader', leaders: [leader(30, '900 YDS')] },
    ];
    const roster = new Map([athlete(30, { position: { abbreviation: 'RB' } })]);
    const out = pickKeyPlayers('football/nfl', categories, roster);
    expect(out).toEqual([expect.objectContaining({ id: '30', role: 'Rushing Leader', stat: '900 YDS' })]);
  });

  it('falls back to points in the NBA when there is no rating list', () => {
    const categories = [{ name: 'pointsPerGame', abbreviation: 'PPG', leaders: [leader(20, '26.0')] }];
    const out = pickKeyPlayers('basketball/nba', categories, new Map([athlete(20)]));
    expect(out).toEqual([expect.objectContaining({ id: '20', stat: '26.0 PPG' })]);
  });

  it('returns nothing for a league it has no plan for', () => {
    expect(pickKeyPlayers('lacrosse/pll', [{ name: 'goals', leaders: [leader(1, '3')] }], new Map([athlete(1)]))).toEqual([]);
  });
});
