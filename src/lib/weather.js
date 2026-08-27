// Daily forecast for the Plans grid, from Open-Meteo. No API key and no
// account — the free tier is CORS-friendly, so the browser calls it directly
// rather than proxying through /api.
//
// Two calls live here: geocode() turns what the user typed ("newport ri")
// into coordinates, and fetchDailyForecast() returns a per-day map keyed by
// the same YYYY-MM-DD strings the grid already uses.

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

// Open-Meteo caps the forecast at 16 days. The Plans grid can reach 20 days
// past today (three weeks anchored to Monday), so its tail simply has no
// forecast yet — those days render without a weather line.
export const FORECAST_DAYS = 16;
// Enough history to cover the earlier days of the current week, which sit
// before "today" but are still on screen.
const PAST_DAYS = 7;

// WMO weather codes → the glyph and words we show. Grouped rather than
// exhaustive: the grid has room for one emoji, not a meteorology lesson.
const WMO = [
  [[0], '☀️', 'Clear'],
  [[1], '🌤', 'Mostly sunny'],
  [[2], '⛅', 'Partly cloudy'],
  [[3], '☁️', 'Overcast'],
  [[45, 48], '🌫', 'Fog'],
  [[51, 53, 55, 56, 57], '🌦', 'Drizzle'],
  [[61, 63, 65, 66, 67], '🌧', 'Rain'],
  [[71, 73, 75, 77], '❄️', 'Snow'],
  [[80, 81, 82], '🌦', 'Showers'],
  [[85, 86], '🌨', 'Snow showers'],
  [[95, 96, 99], '⛈', 'Thunderstorms'],
];

// The codes that mean "you will get wet": drizzle, rain, showers, thunder,
// and snow. Everything else — clear, cloud, fog — is a day the Plans grid
// leaves blank, because the grid is for spotting the days that could spoil a
// plan, not for reading a full forecast.
const WET_CODES = new Set([
  51, 53, 55, 56, 57,       // drizzle
  61, 63, 65, 66, 67,       // rain
  71, 73, 75, 77, 85, 86,   // snow
  80, 81, 82,               // showers
  95, 96, 99,               // thunderstorms
]);

// A "showers" code at 15% is not worth a mark on a planning grid. This is
// roughly where a phone forecast starts bothering to show you a raindrop.
const WET_MIN_PRECIP = 30;

// The day's forecast if it is likely to rain/storm, otherwise null. Days past
// the forecast horizon have no entry at all and fall out here too. Where
// Open-Meteo gives no probability (the far edge of the range), the code alone
// decides rather than the day silently disappearing.
export function wetDay(w) {
  if (!w || !WET_CODES.has(w.code)) return null;
  if (w.precip != null && w.precip < WET_MIN_PRECIP) return null;
  return w;
}

export function describeCode(code) {
  for (const [codes, icon, label] of WMO) {
    if (codes.includes(code)) return { icon, label };
  }
  return { icon: '', label: '' };
}

// City/zip → { label, lat, lng }, or null when nothing matches.
export async function geocode(query) {
  const q = (query || '').trim();
  if (!q) return [];
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not look up that place.');
  const data = await res.json();
  return (data.results || []).map(r => ({
    label: [r.name, r.admin1, r.country_code].filter(Boolean).join(', '),
    lat: r.latitude,
    lng: r.longitude,
  }));
}

// → { 'YYYY-MM-DD': { high, low, precip, code, icon, label } }
// `precip` is the day's max chance of precipitation, in percent.
export async function fetchDailyForecast(lat, lng) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
    past_days: String(PAST_DAYS),
    forecast_days: String(FORECAST_DAYS),
  });
  const res = await fetch(`${FORECAST_URL}?${params}`);
  if (!res.ok) throw new Error('Could not load the forecast.');
  const data = await res.json();
  const d = data.daily || {};
  const out = {};
  (d.time || []).forEach((day, i) => {
    const high = d.temperature_2m_max?.[i];
    const low = d.temperature_2m_min?.[i];
    if (high == null && low == null) return;
    const code = d.weather_code?.[i];
    const { icon, label } = describeCode(code);
    out[day] = {
      high: high == null ? null : Math.round(high),
      low: low == null ? null : Math.round(low),
      precip: d.precipitation_probability_max?.[i] ?? null,
      code,
      icon,
      label,
    };
  });
  return out;
}
