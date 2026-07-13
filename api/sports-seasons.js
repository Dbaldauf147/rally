// Proxy for ESPN season windows (when each sport's season starts/ends). ESPN's
// API sends no CORS headers, so the Sports page can't call it directly. Accepts
// a comma-separated list of whitelisted sportPaths and returns each league's
// current season start/end.
const ALLOWED_SPORT_PATHS = new Set([
  'football/nfl',
  'basketball/nba',
  'baseball/mlb',
  'hockey/nhl',
  'football/college-football',
  'basketball/mens-college-basketball',
  'soccer/usa.1',
  'soccer/eng.1',
]);

async function fetchSeason(sportPath) {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard`);
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  const data = await res.json();
  const season = data?.leagues?.[0]?.season;
  if (!season) return { sportPath, season: null };
  return {
    sportPath,
    season: {
      year: season.year,
      displayName: season.displayName || String(season.year || ''),
      startDate: season.startDate || null,
      endDate: season.endDate || null,
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const raw = String(req.query.sportPaths || req.query.sportPath || '');
  const paths = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
  if (paths.length === 0) return res.status(400).json({ error: 'sportPaths required' });
  if (paths.some((p) => !ALLOWED_SPORT_PATHS.has(p))) {
    return res.status(400).json({ error: 'Unknown or unsupported league' });
  }

  try {
    const seasons = await Promise.all(
      paths.map((p) => fetchSeason(p).catch(() => ({ sportPath: p, season: null }))),
    );
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ seasons });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
