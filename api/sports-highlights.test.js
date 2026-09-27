// The team reel page: which links it accepts, and what it renders.
import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), cert: vi.fn(), getApps: () => [{}] }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: vi.fn() }));

const { parseReelQuery, renderReelPage, teamNameFrom } = await import('./sports-highlights.js');

const DAY = 86400000;
const NOW = 1_800_000_000_000;

describe('parseReelQuery', () => {
  it('takes a team and a window', () => {
    expect(parseReelQuery({ team: 'baseball/mlb:10', from: String(NOW - DAY), to: String(NOW) }, NOW))
      .toEqual({ team: 'baseball/mlb:10', from: NOW - DAY, to: NOW });
  });
  it('rejects anything that is not a team key', () => {
    expect(parseReelQuery({ team: '../users' }, NOW)).toBeNull();
    expect(parseReelQuery({}, NOW)).toBeNull();
  });
  it('defaults to a week and caps a long window', () => {
    expect(parseReelQuery({ team: 'hockey/nhl:4' }, NOW)).toEqual({ team: 'hockey/nhl:4', from: NOW - 7 * DAY, to: NOW });
    expect(parseReelQuery({ team: 'hockey/nhl:4', from: '1', to: String(NOW) }, NOW).from).toBe(NOW - 35 * DAY);
  });
});

const game = (eventId, clips) => ({
  eventId, iso: '2026-09-25T23:30Z', when: 1,
  competitors: [
    { id: '10', abbrev: 'NYY', name: 'New York Yankees', home: true, score: '5', winner: true },
    { id: '1', abbrev: 'BAL', name: 'Baltimore Orioles', home: false, score: '3', winner: false },
  ],
  clips,
});

describe('renderReelPage', () => {
  it('plays every clip in order and lists each game', () => {
    const html = renderReelPage({
      teamName: 'New York Yankees',
      games: [
        game('1', [{ kind: 'reel', title: 'x', href: 'https://www.espn.com/video/clip/_/id/1', src: 'https://espnmedia-cdn.akamaized.net/a.mp4', duration: 62 }]),
        game('2', [{ kind: 'play', title: 'Judge <homers>', href: 'https://www.espn.com/video/clip/_/id/2', src: 'https://espnmedia-cdn.akamaized.net/b.mp4', duration: 30 }]),
      ],
    });
    expect(html).toContain('<title>New York Yankees highlights</title>');
    expect(html).toContain('2 games · 1:32 of video');
    expect(html.indexOf('a.mp4')).toBeLessThan(html.indexOf('b.mp4'));
    expect(html).toContain('Judge &lt;homers&gt;');
  });

  it('links out to ESPN when there is no file, and never to a foreign host', () => {
    const html = renderReelPage({
      teamName: 'T',
      games: [game('1', [
        { kind: 'reel', title: 'x', href: 'https://www.espn.com/video/clip/_/id/1', duration: 50 },
        { kind: 'play', title: 'y', href: 'https://evil.example/', src: 'https://evil.example/x.mp4', duration: 10 },
      ])],
    });
    expect(html).toContain('href="https://www.espn.com/video/clip/_/id/1"');
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('<video');
  });

  it('says so when nothing is saved', () => {
    expect(renderReelPage({ teamName: 'T', games: [] })).toContain('No highlights saved');
  });
});

describe('teamNameFrom', () => {
  it('reads the name off the stored games', () => {
    expect(teamNameFrom([game('1', [])], 'baseball/mlb:1')).toBe('Baltimore Orioles');
    expect(teamNameFrom([], 'baseball/mlb:1')).toBe('Your team');
  });
});
