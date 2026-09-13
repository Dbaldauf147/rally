// A team's key players for the sports digest: the five who matter most right
// now, left out if they aren't actually playing. Kept outside api/ so Vercel
// doesn't treat it as an endpoint.
//
// "Matter most" comes from ESPN's per-team leader lists in the core API
// (sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/seasons/{year}
// /types/{type}/teams/{id}/leaders). What a leader list can rank by differs by
// sport, so each gets a plan:
//   • one overall measure where ESPN has one — WAR in baseball, ESPN's rating
//     in the NBA, points in hockey — read straight down;
//   • otherwise the positions that carry a team, taken in turn — football's
//     passer, rusher, receiver, tackler and pass rusher; soccer's scorers and
//     creators.
//
// "Actually playing" comes from the team roster, which carries the same athlete
// ids plus a roster status and any injury designation. Someone out, on injured
// reserve, on the practice squad, or no longer on the roster is skipped and the
// next name on the list moves up.

const PLANS = {
  baseball: ['WARBR'],
  'basketball/nba': ['rating', 'pointsPerGame'],
  basketball: ['PER', 'pointsPerGame'],
  hockey: ['points'],
  football: ['passingLeader', 'rushingLeader', 'receivingLeader', 'totalTackles', 'sacks'],
  soccer: ['goals', 'assists'],
};

// A role only its own position can fill. With last season's passers gone, the
// next name on the passing list is a running back with one trick-play throw —
// technically the leader, and nobody's idea of a key player.
const ROLE_POSITIONS = { passingLeader: /^QB$/ };

// Categories that are fallbacks for one another rather than a rotation: an
// NBA leader list without `rating` still ranks by points.
const SINGLE_MEASURE = new Set(['baseball', 'basketball/nba', 'basketball', 'hockey']);

function planFor(sportPath) {
  const [sport] = String(sportPath).split('/');
  const key = PLANS[sportPath] ? sportPath : sport;
  return PLANS[key] ? { key, categories: PLANS[key], single: SINGLE_MEASURE.has(key) } : null;
}

const NOT_PLAYING_STATUS = /practice squad|injured|reserve|suspend|inactive|minors|non-roster/i;
const NOT_PLAYING_INJURY = /out|reserve|doubtful|suspend|\bil\b/i;

// Whether a roster athlete is available to play. Day-to-day and questionable
// still count: they're listed, and usually suit up.
export function isPlaying(athlete) {
  if (!athlete) return false;
  if (NOT_PLAYING_STATUS.test(athlete.status?.name || athlete.status?.type || '')) return false;
  return !(athlete.injuries || []).some((i) => NOT_PLAYING_INJURY.test(i?.status || ''));
}

const athleteIdOf = (leader) => (/athletes\/(\d+)/.exec(leader?.athlete?.$ref || '') || [])[1] || '';

// A bare number reads as nothing on its own ("4.6"), so it takes the
// category's abbreviation; a stat line ESPN already wrote out stays as is.
function statText(leader, category) {
  const value = String(leader?.displayValue ?? '').trim();
  if (!value) return '';
  if (!/^[-+]?[\d.,]+%?$/.test(value)) return value;
  const unit = category.abbreviation || category.shortDisplayName || '';
  return unit ? `${value} ${unit}` : value;
}

/* The pick itself, given the leader categories and the roster. Pure, so it can
 * be tested without ESPN.
 *
 * `categories` is the leaders payload's `categories`; `roster` is a Map of
 * athlete id → roster athlete. Returns up to `limit` players, most important
 * first, each { id, name, position, headshot, stat, role }. */
export function pickKeyPlayers(sportPath, categories, roster, limit = 5) {
  const plan = planFor(sportPath);
  if (!plan || !Array.isArray(categories)) return [];
  const byName = new Map(categories.map((c) => [c.name, c]));
  const lists = plan.categories.map((name) => byName.get(name)).filter((c) => c?.leaders?.length);
  if (lists.length === 0) return [];

  const chosen = [];
  const seen = new Set();
  const take = (category, leader) => {
    const id = athleteIdOf(leader);
    if (!id || seen.has(id)) return false;
    const athlete = roster.get(id);
    if (!isPlaying(athlete)) return false;
    const fits = ROLE_POSITIONS[category.name];
    if (fits && !fits.test(athlete.position?.abbreviation || '')) return false;
    seen.add(id);
    chosen.push({
      id,
      name: athlete.displayName || athlete.fullName || '',
      position: athlete.position?.abbreviation || '',
      headshot: athlete.headshot?.href || '',
      stat: statText(leader, category),
      role: lists.length > 1 ? category.displayName || '' : '',
    });
    return true;
  };

  if (plan.single) {
    // One ranking: the first category ESPN actually has, read top-down.
    const [category] = lists;
    for (const leader of category.leaders) {
      if (chosen.length >= limit) break;
      take(category, leader);
    }
    return chosen;
  }

  // A rotation: the best available from each category in turn, then round
  // again for whoever is next in line, until the five are filled or every list
  // is spent.
  const cursors = lists.map(() => 0);
  let progressed = true;
  while (chosen.length < limit && progressed) {
    progressed = false;
    lists.forEach((category, i) => {
      if (chosen.length >= limit) return;
      while (cursors[i] < category.leaders.length) {
        const leader = category.leaders[cursors[i]];
        cursors[i] += 1;
        if (take(category, leader)) { progressed = true; return; }
      }
    });
  }
  return chosen;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function fetchRoster(sportPath, teamId) {
  const data = await getJson(`https://site.api.espn.com/apis/site/v2/sports/${sportPath}/teams/${teamId}/roster`);
  // Most sports group the roster by position (athletes[].items); a few return
  // the athletes flat.
  const athletes = (data?.athletes || []).flatMap((a) => (Array.isArray(a?.items) ? a.items : [a]));
  return new Map(athletes.filter((a) => a?.id).map((a) => [String(a.id), a]));
}

/* The leader categories for a team this season.
 *
 * The regular season is type 2 in the US leagues but type 1 in ESPN's soccer
 * feeds — and type 1 is the PRESEASON everywhere else, so it is only ever
 * asked for in soccer (the digest keeps exhibitions out of every other
 * section too). A season only a week old may have no team leaders computed
 * yet, so it falls back to last season; those numbers still say who matters,
 * and the roster check keeps anyone who has since left off the list. `year` in
 * the result is the season the numbers came from. */
async function fetchLeaders(sportPath, teamId, year) {
  const [sport, league] = String(sportPath).split('/');
  const types = sport === 'soccer' ? [1] : [2];
  for (const y of [year, year - 1]) {
    for (const type of types) {
      const data = await getJson(`https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/seasons/${y}/types/${type}/teams/${teamId}/leaders`);
      if (data?.categories?.some((c) => c.leaders?.length)) return { year: y, categories: data.categories };
    }
  }
  return null;
}

// Everything the digest needs for one team. Best-effort: null on no data.
export async function fetchKeyPlayers(team, season, limit = 5) {
  const year = Number(season?.year);
  if (!planFor(team.sportPath) || !year) return null;
  const [leaders, roster] = await Promise.all([
    fetchLeaders(team.sportPath, team.teamId, year),
    fetchRoster(team.sportPath, team.teamId),
  ]);
  if (!leaders || roster.size === 0) return null;
  const players = pickKeyPlayers(team.sportPath, leaders.categories, roster, limit);
  return players.length ? { players, year: leaders.year, lastSeason: leaders.year !== year } : null;
}
