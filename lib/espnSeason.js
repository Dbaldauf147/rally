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
  season.phases = await fetchPhases(sportPath, s.year).catch(() => []);
  return season;
}
