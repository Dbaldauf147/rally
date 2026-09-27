// The highlight store: what's kept, what's re-asked, and what the reel page
// gets back for a team and a window.
import { describe, it, expect, vi } from 'vitest';
import { attachStoredHighlights, storedTeamHighlights, reelSummary, highlightDocId, teamKey } from './sportsHighlightStore.js';

// Just enough Firestore: doc refs, getAll, set, and one array-contains query.
function fakeDb(initial = {}) {
  const docs = new Map(Object.entries(initial));
  const ref = (id) => ({
    id,
    set: vi.fn(async (data) => { docs.set(id, data); }),
  });
  return {
    docs,
    collection: () => ({
      doc: ref,
      where: (field, op, value) => ({
        get: async () => ({
          docs: [...docs.values()].filter((d) => d[field]?.includes(value)).map((d) => ({ data: () => d })),
        }),
      }),
    }),
    getAll: async (...refs) => refs.map((r) => ({ id: r.id, exists: docs.has(r.id), data: () => docs.get(r.id) })),
  };
}

const team = { sportPath: 'baseball/mlb', teamId: '10', name: 'New York Yankees' };
const reel = { kind: 'reel', title: 'Game Highlights', href: 'https://www.espn.com/video/clip/_/id/1', src: 'https://espnmedia-cdn.akamaized.net/a.mp4', duration: 62 };
const game = (eventId, when) => ({
  eventId, when, iso: new Date(when).toISOString(),
  competitors: [
    { id: '10', abbrev: 'NYY', name: 'New York Yankees', home: true, score: '5', winner: true },
    { id: '1', abbrev: 'BAL', name: 'Baltimore Orioles', home: false, score: '3', winner: false },
  ],
});

describe('attachStoredHighlights', () => {
  it('uses stored clips without asking ESPN', async () => {
    const db = fakeDb({ [highlightDocId('baseball/mlb', '7')]: { clips: [reel] } });
    const fetchClips = vi.fn();
    const games = [game('7', 1000)];
    await attachStoredHighlights(db, team, games, fetchClips);
    expect(fetchClips).not.toHaveBeenCalled();
    expect(games[0].highlights).toEqual([reel]);
  });

  it('fetches what is missing and keeps it under both teams', async () => {
    const db = fakeDb();
    const games = [game('8', 2000)];
    await attachStoredHighlights(db, team, games, async () => [reel]);
    const saved = db.docs.get('baseball_mlb_8');
    expect(saved.clips).toEqual([reel]);
    expect(saved.teamKeys.sort()).toEqual(['baseball/mlb:1', 'baseball/mlb:10']);
    expect(saved.when).toBe(2000);
  });

  it('does not store a game ESPN had nothing for, so it is asked again', async () => {
    const db = fakeDb();
    const games = [game('9', 3000)];
    await attachStoredHighlights(db, team, games, async () => []);
    expect(games[0].highlights).toEqual([]);
    expect(db.docs.size).toBe(0);
  });

  it('a failed fetch costs that game its clips and nothing else', async () => {
    const db = fakeDb();
    const games = [game('1', 1), game('2', 2)];
    await attachStoredHighlights(db, team, games, async (_, id) => { if (id === '1') throw new Error('500'); return [reel]; });
    expect(games.map((g) => g.highlights.length)).toEqual([0, 1]);
  });
});

describe('storedTeamHighlights', () => {
  it("returns the team's games inside the window, oldest first", async () => {
    const db = fakeDb();
    const games = [game('3', 300), game('1', 100), game('2', 200), game('4', 900)];
    await attachStoredHighlights(db, team, games, async () => [reel]);
    const out = await storedTeamHighlights(db, teamKey('baseball/mlb', '10'), 100, 300);
    expect(out.map((g) => g.eventId)).toEqual(['1', '2', '3']);
    expect(await storedTeamHighlights(db, 'baseball/mlb:99', 0, 1000)).toEqual([]);
  });
});

describe('reelSummary', () => {
  it('counts games with footage and adds up their length', () => {
    expect(reelSummary([{ highlights: [reel] }, { highlights: [] }, { highlights: [{ duration: 20 }, { duration: 30 }] }]))
      .toEqual({ games: 2, seconds: 112 });
  });
});
