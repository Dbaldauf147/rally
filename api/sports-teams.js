// Proxy for ESPN's team list. ESPN's public API doesn't send CORS headers, so
// the browser can't call it directly — the Sports team picker calls this instead.
// Only whitelisted leagues are allowed so this can't be used as an open proxy.
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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const sportPath = String(req.query.sportPath || '');
  if (!ALLOWED_SPORT_PATHS.has(sportPath)) {
    return res.status(400).json({ error: 'Unknown or unsupported league' });
  }

  try {
    const espnRes = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/teams?limit=1000`,
    );
    if (!espnRes.ok) {
      return res.status(502).json({ error: `ESPN returned HTTP ${espnRes.status}` });
    }
    const data = await espnRes.json();
    const raw = data?.sports?.[0]?.leagues?.[0]?.teams || [];
    const teams = raw
      .map((t) => t.team)
      .filter(Boolean)
      .map((t) => ({
        teamId: t.id,
        name: t.displayName,
        abbrev: t.abbreviation || '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // Small, stable list — cache at the edge for a day.
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=86400');
    return res.status(200).json({ teams });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
