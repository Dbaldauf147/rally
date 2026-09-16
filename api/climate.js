// Typical weather for a place: what the last ten years actually did there.
//
// The browser could call Open-Meteo directly (lib/weather.js does, for the
// Plans forecast), but an event's location is a street address —
// "225 West 34th Street, 2nd Floor, New York, NY 10001" — and Open-Meteo's
// geocoder only knows place names. Google's geocoder knows addresses, and its
// key is server-side (the same GOOGLE_MAPS_SERVER_KEY api/travel-time.js
// uses), so the lookup happens here. Without a key it falls back to
// Open-Meteo's geocoder, which still handles "Newport, RI" shaped locations.
//
// The archive read is here too, so one warm instance answers repeat views
// without going out at all, and the client keeps its own copy besides.
//
// GET /api/climate?location=<what the event says>
// → { place: { label, lat, lng }, years: [from, to], byDay: { 'MM-DD': { high, low, n } } }

import { averageByDay, archiveSpan, locationQueries } from '../src/lib/climate.js';

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const GOOGLE_GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json';
const OPEN_METEO_GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

// Per instance, and only as long as one lives: a climate normal is the same
// tomorrow, and a cold start just fetches again.
const cache = new Map();
const TTL_MS = 12 * 60 * 60 * 1000;

async function geocodeGoogle(query, key) {
  const url = `${GOOGLE_GEOCODE}?address=${encodeURIComponent(query)}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const hit = data.status === 'OK' ? data.results?.[0] : null;
  if (!hit?.geometry?.location) return null;
  return { label: hit.formatted_address || query, lat: hit.geometry.location.lat, lng: hit.geometry.location.lng };
}

async function geocodeOpenMeteo(query) {
  const res = await fetch(`${OPEN_METEO_GEOCODE}?name=${encodeURIComponent(query)}&count=1&language=en&format=json`);
  if (!res.ok) return null;
  const hit = (await res.json()).results?.[0];
  if (!hit) return null;
  return {
    label: [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(', '),
    lat: hit.latitude,
    lng: hit.longitude,
  };
}

export default async function handler(req, res) {
  const location = String(req.query?.location || '').trim();
  if (!location) return res.status(400).json({ error: 'Missing location' });

  const cached = cache.get(location.toLowerCase());
  if (cached && Date.now() - cached.at < TTL_MS) return res.status(200).json(cached.body);

  // Through globalThis so this file lints under the browser globals the repo
  // uses for everything (see eslint.config.js).
  const env = globalThis.process?.env || {};
  const key = env.GOOGLE_MAPS_SERVER_KEY || env.VITE_GOOGLE_MAPS_EMBED_KEY;
  let place = null;
  try {
    // The whole address first, then broader parts of it, as lib/climate says.
    for (const query of locationQueries(location)) {
      place = key ? await geocodeGoogle(query, key) : await geocodeOpenMeteo(query);
      if (place) break;
    }
  } catch (err) {
    return res.status(502).json({ error: `Could not look up that place: ${err.message}` });
  }
  if (!place) return res.status(404).json({ error: `Could not find “${location}” on the map.` });

  const span = archiveSpan();
  const params = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lng),
    start_date: span.start,
    end_date: span.end,
    daily: 'temperature_2m_max,temperature_2m_min',
    temperature_unit: 'fahrenheit',
    timezone: 'UTC',
  });
  let byDay;
  try {
    const archive = await fetch(`${ARCHIVE_URL}?${params}`);
    if (!archive.ok) return res.status(502).json({ error: 'Could not load past weather for that place.' });
    const daily = (await archive.json()).daily || {};
    byDay = averageByDay(daily.time, daily.temperature_2m_max, daily.temperature_2m_min);
  } catch (err) {
    return res.status(502).json({ error: `Could not load past weather: ${err.message}` });
  }
  if (!Object.keys(byDay).length) {
    return res.status(404).json({ error: 'No past weather recorded for that place.' });
  }

  const body = { place, years: span.years, byDay };
  cache.set(location.toLowerCase(), { at: Date.now(), body });
  // A day in a CDN too: the answer is the same for everyone asking about this place.
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  return res.status(200).json(body);
}
