// Keeps each game's highlight clips once ESPN has published them. Lives outside
// api/ so Vercel doesn't route it, same as the other ESPN helpers.
//
// ESPN unhooks a game's video from its summary about two days after the final,
// so a weekly digest asking on Sunday found links for Friday and Saturday and
// nothing earlier. The files themselves stay up — it's only the game → clip
// link that goes. So the daily cron asks while ESPN still answers and keeps the
// answer here, and everything that shows highlights (the digest, the team reel
// page) reads this first and ESPN second.
//
// One doc per game in `sportsHighlights`, written only by the server (Admin
// SDK); no client reads it, so it needs no Firestore rule.
import { fetchGameHighlights } from './espnHighlights.js';

export const HIGHLIGHTS_COLLECTION = 'sportsHighlights';

// A followed team, as the reel page's link names it: "baseball/mlb:10".
export const teamKey = (sportPath, teamId) => `${sportPath}:${teamId}`;

// Doc ids can't hold a slash.
export const highlightDocId = (sportPath, eventId) => `${String(sportPath).replace(/\//g, '_')}_${eventId}`;

/* Clips for each game, stored where we have them and fetched where we don't —
 * and a fetch that finds video is kept for next time. Sets `g.highlights` on
 * each game in place. Best-effort per game, like the fetch it wraps: a game
 * that fails just has no clips.
 *
 * A game ESPN had nothing for isn't stored, so it's asked about again next
 * run — reels sometimes land a few hours after the final.
 */
export async function attachStoredHighlights(db, team, games, fetchClips = fetchGameHighlights) {
  const withIds = games.filter((g) => g.eventId);
  if (withIds.length === 0) return;
  const col = db.collection(HIGHLIGHTS_COLLECTION);
  const refs = withIds.map((g) => col.doc(highlightDocId(team.sportPath, g.eventId)));
  const snaps = await db.getAll(...refs).catch(() => []);
  const stored = new Map();
  for (const s of snaps) if (s.exists) stored.set(s.id, s.data());

  await Promise.all(withIds.map(async (g, i) => {
    const have = stored.get(refs[i].id);
    if (have?.clips?.length) {
      g.highlights = have.clips;
      return;
    }
    g.highlights = await fetchClips(team.sportPath, g.eventId).catch(() => []);
    if (g.highlights.length === 0) return;
    const keys = new Set([teamKey(team.sportPath, team.teamId)]);
    for (const c of g.competitors || []) if (c.id) keys.add(teamKey(team.sportPath, c.id));
    await refs[i].set({
      sportPath: team.sportPath,
      eventId: String(g.eventId),
      iso: g.iso || null,
      when: g.when ?? (g.iso ? new Date(g.iso).getTime() : null),
      teamKeys: [...keys],
      competitors: (g.competitors || []).map((c) => ({
        id: c.id ? String(c.id) : null,
        abbrev: c.abbrev || '',
        name: c.name || '',
        logo: c.logo || '',
        home: !!c.home,
        score: c.score ?? '',
        winner: !!c.winner,
      })),
      clips: g.highlights,
      savedAt: Date.now(),
    }).catch(() => {});
  }));
}

// Every stored game for one team between two instants, oldest first — what the
// reel page plays. One array-contains filter, so no composite index; the date
// window is applied here.
export async function storedTeamHighlights(db, key, fromMs, toMs) {
  const snap = await db.collection(HIGHLIGHTS_COLLECTION).where('teamKeys', 'array-contains', key).get();
  return snap.docs
    .map((d) => d.data())
    .filter((g) => g.when >= fromMs && g.when <= toMs && g.clips?.length)
    .sort((a, b) => a.when - b.when);
}

// Footage in a set of games, for the link's "4 games · 3:52".
export function reelSummary(games) {
  const withClips = games.filter((g) => g.highlights?.length);
  const seconds = withClips.reduce((n, g) => n + g.highlights.reduce((m, c) => m + (c.duration || 0), 0), 0);
  return { games: withClips.length, seconds };
}
