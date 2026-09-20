// Highlights for a finished game, kept to a two-minute watch. Lives outside
// api/ so Vercel doesn't route it, same as the other ESPN helpers.
//
// ESPN hangs a game's video off the summary endpoint
// (site.api.espn.com/apis/site/v2/sports/{sportPath}/summary?event={id}), and
// what comes back is a mixed bag: the cut-down reel, every scoring play as its
// own clip, and — in soccer especially — studio analysis and press conferences
// that have nothing to do with watching the game. `tracking.coverageType` is
// what tells them apart:
//   • "Final Game Highlight" — the reel. One link, usually under a minute.
//   • "OnePlay" — a single play. The building blocks when there's no reel.
//   • "Analysis", "PressConference", … — talking, not playing. Dropped.
//
// Leagues differ in what they publish: MLB and the NHL nearly always have a
// reel, college football ships a pile of OnePlay clips and no reel, and the NFL
// answers with no video at all (ESPN doesn't carry it). A game with nothing
// usable returns an empty list and simply gets no link.

const BUDGET_SECONDS = 120;
const MAX_CLIPS = 4;

const REEL_TYPE = /game highlight|highlights|recap|condensed/i;
const PLAY_TYPE = /oneplay|top play/i;

// Filed as a play, but it's someone at a podium. ESPN drops postgame interviews
// into the OnePlay bucket often enough that the headline has to be read too.
const TALKING = /\b(elaborates|discusses|talks|speaks|reacts|previews|interview|press conference|postgame|on (his|the|their)\b)/i;

const webHref = (v) => v?.links?.web?.href || v?.links?.web?.self?.href || '';

function toClip(v) {
  const type = String(v?.tracking?.coverageType || '');
  const title = String(v?.headline || v?.description || '').trim();
  const href = webHref(v);
  const duration = Math.round(Number(v?.duration) || 0);
  let kind = null;
  // No coverageType at all: the headline is the only thing left to go on, and
  // it only ever earns the reel slot by saying so.
  if (REEL_TYPE.test(type) || (!type && REEL_TYPE.test(title))) kind = 'reel';
  else if (PLAY_TYPE.test(type) && !TALKING.test(title)) kind = 'play';
  if (!kind || !href || duration <= 0) return null;
  return { kind, title, href, duration };
}

/* The clips worth linking for one game, inside `budget` seconds of footage.
 *
 * A reel that fits is the whole answer — it's the game, already edited. With no
 * reel (or one that runs long), the plays stand in: the longest first, because
 * clip length tracks how big the moment was — a walk-off homer runs 45 seconds
 * and a field goal 9 — then put back in the order they happened so the game
 * still reads forward.
 */
export function pickHighlightClips(videos, budget = BUDGET_SECONDS) {
  const clips = (videos || []).map(toClip).filter((c) => c && c.duration <= budget);
  const reel = clips.filter((c) => c.kind === 'reel').sort((a, b) => b.duration - a.duration)[0];
  if (reel) return [reel];

  const plays = clips.filter((c) => c.kind === 'play');
  const picked = [];
  let total = 0;
  for (const c of [...plays].sort((a, b) => b.duration - a.duration)) {
    if (picked.length >= MAX_CLIPS) break;
    // Not `break`: a shorter clip further down the list may still fit.
    if (total + c.duration > budget) continue;
    picked.push(c);
    total += c.duration;
  }
  return picked.sort((a, b) => plays.indexOf(a) - plays.indexOf(b));
}

// Runtime as a clock reads faster than "57s" next to a link.
export function fmtClipLength(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export async function fetchGameHighlights(sportPath, eventId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${encodeURIComponent(eventId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  const data = await res.json();
  return pickHighlightClips(data.videos);
}
