// Proxy for ESPN season windows + phases (when each sport's season starts/ends,
// and its sub-phases like Regular Season / Postseason). ESPN's API sends no CORS
// headers, so the Sports page can't call it directly. Accepts a comma-separated
// list of whitelisted sportPaths.
import { fetchSeasonWithPhases } from '../lib/espnSeason.js';

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

  const raw = String(req.query.sportPaths || req.query.sportPath || '');
  const paths = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
  if (paths.length === 0) return res.status(400).json({ error: 'sportPaths required' });
  if (paths.some((p) => !ALLOWED_SPORT_PATHS.has(p))) {
    return res.status(400).json({ error: 'Unknown or unsupported league' });
  }

  try {
    const seasons = await Promise.all(
      paths.map((p) =>
        fetchSeasonWithPhases(p)
          .then((season) => ({ sportPath: p, season }))
          .catch(() => ({ sportPath: p, season: null })),
      ),
    );
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ seasons });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
