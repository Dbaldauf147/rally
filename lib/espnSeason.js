// Shared ESPN season + phase fetching, used by both api/sports-seasons.js
// (the page's Season calendars card) and api/sports-digest.js (the email).
// Kept outside api/ so Vercel doesn't treat it as an endpoint.

// Phase breakdown (Preseason/Regular Season/Postseason/Off Season, etc.) from
// ESPN's core API. Each season "type" is a $ref that must be fetched for its
// name + dates. Best-effort: returns [] on any failure.
async function fetchPhases(sportPath, year) {
  const [sport, league] = String(sportPath).split('/');
  if (!sport || !league || !year) return [];
  const typesUrl = `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/seasons/${year}/types?limit=20`;
  const res = await fetch(typesUrl);
  if (!res.ok) return [];
  const j = await res.json();
  const refs = (j.items || [])
    .map((i) => String(i['$ref'] || '').replace(/^http:/, 'https:'))
    .filter(Boolean);
  const details = await Promise.all(
    refs.map((r) => fetch(r).then((x) => x.json()).catch(() => null)),
  );
  return details
    .filter((t) => t && t.name && t.startDate && t.endDate)
    .map((t) => ({ name: t.name, startDate: t.startDate, endDate: t.endDate }))
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
}

// The draft as a dated event, where ESPN exposes it (NFL/NBA). Returns a
// phase-shaped entry so it slots into the timeline; null otherwise.
async function fetchDraft(sportPath, year) {
  const [sport, league] = String(sportPath).split('/');
  if (!sport || !league || !year) return null;
  const res = await fetch(`https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/seasons/${year}/draft`);
  if (!res.ok) return null;
  const j = await res.json();
  if (!j || j.error || !j.startDate) return null;
  return { name: 'Draft', startDate: j.startDate, endDate: j.endDate || j.startDate };
}

// A league draft's picks for the given teams, as
// { [teamId]: [{ round, overall, player, position }] } in pick order.
//
// The core API nests draft → rounds → picks, and each pick's athlete is a $ref
// that has to be fetched on its own. Rounds and their picks come back inline in
// one call, so narrowing to the teams we care about BEFORE resolving athletes
// keeps this at a handful of requests instead of the ~260 a full seven-round
// NFL draft would need. No cap and nothing dropped: every pick those teams made
// is returned.
//
// Only NFL and NBA have this endpoint; NHL, MLB, college and soccer return
// nothing and callers get an empty map.
export async function fetchDraftPicks(sportPath, year, teamIds) {
  const [sport, league] = String(sportPath).split('/');
  const wanted = new Set((teamIds || []).map(String));
  if (!sport || !league || !year || wanted.size === 0) return {};
  const url = `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/seasons/${year}/draft/rounds?limit=20`;
  const res = await fetch(url);
  if (!res.ok) return {};
  const j = await res.json();
  const mine = [];
  for (const round of j.items || []) {
    for (const pick of round.picks || []) {
      const teamId = String(pick.team?.$ref || '').match(/teams\/(\d+)/)?.[1];
      if (teamId && wanted.has(teamId)) mine.push({ teamId, round: Number(round.number) || null, pick });
    }
  }
  const resolved = await Promise.all(mine.map(async ({ teamId, round, pick }) => {
    let athlete = pick.athlete;
    if (athlete?.$ref) {
      athlete = await fetch(String(athlete.$ref).replace(/^http:/, 'https:'))
        .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    }
    return {
      teamId,
      round: round || Number(pick.round) || null,
      overall: Number(pick.overall) || null,
      player: athlete?.displayName || athlete?.fullName || '',
      position: athlete?.position?.abbreviation || '',
    };
  }));
  const byTeam = {};
  for (const p of resolved) {
    if (!p.player) continue;
    (byTeam[p.teamId] ||= []).push(p);
  }
  for (const list of Object.values(byTeam)) list.sort((a, b) => (a.overall || 0) - (b.overall || 0));
  return byTeam;
}

// Full season window + phases for a league. Returns null if ESPN has no season.
export async function fetchSeasonWithPhases(sportPath) {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard`);
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  const data = await res.json();
  const s = data?.leagues?.[0]?.season;
  if (!s) return null;
  const season = {
    year: s.year,
    displayName: s.displayName || String(s.year || ''),
    startDate: s.startDate || null,
    endDate: s.endDate || null,
    phases: [],
  };
  const [phases, draft] = await Promise.all([
    fetchPhases(sportPath, s.year).catch(() => []),
    fetchDraft(sportPath, s.year).catch(() => null),
  ]);
  season.phases = (draft ? [...phases, draft] : phases)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  return season;
}
