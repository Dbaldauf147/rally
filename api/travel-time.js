// Proxies Google Distance Matrix API so we can show travel time on route cards.
// Uses GOOGLE_MAPS_SERVER_KEY (server-side, no referrer restriction).
// Falls back to VITE_GOOGLE_MAPS_EMBED_KEY if set without referrer restriction.
export default async function handler(req, res) {
  const { origin, destination, mode = 'driving' } = req.query || {};
  if (!origin || !destination) {
    return res.status(400).json({ error: 'Missing origin or destination' });
  }

  const key = process.env.GOOGLE_MAPS_SERVER_KEY || process.env.VITE_GOOGLE_MAPS_EMBED_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Maps key not configured on server' });
  }

  // Google Distance Matrix supports: driving, walking, bicycling, transit.
  // "flying" isn't supported — we fall back to driving for an estimate.
  const googleMode = ['walking', 'bicycling', 'transit'].includes(mode) ? mode : 'driving';

  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
  url.searchParams.set('origins', origin);
  url.searchParams.set('destinations', destination);
  url.searchParams.set('mode', googleMode);
  url.searchParams.set('key', key);

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.status && data.status !== 'OK') {
      return res.status(502).json({ error: data.error_message || data.status });
    }
    const element = data?.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') {
      return res.status(404).json({ error: element?.status || 'No route found' });
    }
    return res.json({
      duration: element.duration?.text || null,
      durationSeconds: element.duration?.value || null,
      distance: element.distance?.text || null,
      mode: googleMode,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
