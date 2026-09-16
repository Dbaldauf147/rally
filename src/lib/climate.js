// Typical weather for a date, from what the weather actually did there in
// past years.
//
// Not a forecast: a date six months out has none, and that is exactly when a
// poll is being voted on. So this reads Open-Meteo's ERA5 archive — the same
// free, key-less, CORS-friendly service as lib/weather.js — for the last ten
// full years at the event's coordinates, and averages the daily high and low
// over a window around each candidate date. A window rather than the single
// calendar day, because one year's 12 October says much less about "what is
// mid-October like there" than the week around it in ten years does.
//
// One request per place, whatever the poll has in it: a whole ten years of
// daily highs and lows is a couple of thousand numbers, which is smaller than
// it sounds and lets every date option be answered from the same download.
// The answer is then kept per place, since what October is like in Newport
// does not change between two events there.

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

// Days either side of a date that count as "this time of year".
export const SPREAD = 3;
// How many past years to average. Ten is long enough to drown out one freak
// year and short enough to still describe the climate as it is now.
export const YEARS = 10;

const CACHE_KEY = 'rally.climate.v1';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // a month; a climate normal does not move faster

const pad = (n) => String(n).padStart(2, '0');

const parseDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
};

/* The month-days that count for one date option: every day it covers, plus
   SPREAD either side. Returned as MM-DD, because the year is what we are
   averaging over.

   A long option (a week in a rental) is capped: past a month, "typical" stops
   meaning anything and the window would swallow a season. */
export function windowKeys(startDate, endDate, spread = SPREAD) {
  const start = parseDay(startDate);
  if (!start) return [];
  const end = parseDay(endDate) || start;
  const last = end < start ? start : end;
  const days = Math.min(Math.round((last - start) / 86400000), 30);
  const keys = [];
  for (let i = -spread; i <= days + spread; i += 1) {
    const d = new Date(start.getTime() + i * 86400000);
    keys.push(`${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
  }
  return [...new Set(keys)];
}

// The ten full years to average: this year is still running, so it ends at
// last year. (ERA5 lags real time by a few days, which a finished year is
// safely clear of.)
export function archiveSpan(today = new Date(), years = YEARS) {
  const lastFull = today.getUTCFullYear() - 1;
  return { start: `${lastFull - years + 1}-01-01`, end: `${lastFull}-12-31`, years: [lastFull - years + 1, lastFull] };
}

/* The daily series → the average high and low for each month-day.
   29 February exists in a quarter of the years and is kept as itself; a
   window that includes it simply has fewer readings for that one day. */
export function averageByDay(time = [], highs = [], lows = []) {
  const sums = {};
  time.forEach((day, i) => {
    const key = String(day).slice(5);
    const high = highs[i];
    const low = lows[i];
    if (high == null && low == null) return;
    const s = sums[key] || (sums[key] = { high: 0, low: 0, n: 0 });
    if (high != null) s.high += high;
    if (low != null) s.low += low;
    s.n += 1;
  });
  const out = {};
  for (const [key, s] of Object.entries(sums)) {
    if (!s.n) continue;
    out[key] = { high: s.high / s.n, low: s.low / s.n, n: s.n };
  }
  return out;
}

/* One date option's typical high and low: the window's days, averaged.
   Null when the window landed on nothing — a place the archive has no data
   for, rather than a zero that would read as freezing. */
export function normalFor(byDay, startDate, endDate, spread = SPREAD) {
  const keys = windowKeys(startDate, endDate, spread);
  let high = 0;
  let low = 0;
  let days = 0;
  let readings = 0;
  for (const key of keys) {
    const d = byDay?.[key];
    if (!d) continue;
    high += d.high;
    low += d.low;
    days += 1;
    readings += d.n;
  }
  if (!days) return null;
  return { high: Math.round(high / days), low: Math.round(low / days), days, readings };
}

// Cached per place, not per event: two events in the same town share it.
// Coordinates are rounded to ~1km, which is far finer than a climate normal.
export const cacheKeyFor = (lat, lng) => `${Number(lat).toFixed(2)},${Number(lng).toFixed(2)}`;

function readCache(key, now) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    const hit = all[key];
    if (hit && now - hit.at < CACHE_TTL_MS) return hit;
  } catch { /* a corrupt cache just means we fetch again */ }
  return null;
}

function writeCache(key, value) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    all[key] = value;
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch { /* private mode, or full: the fetch still worked */ }
}

/* Ten years of daily highs and lows at one place, averaged per month-day.
   → { byDay: { 'MM-DD': { high, low, n } }, years: [from, to] } */
export async function fetchClimateNormals(lat, lng, { today = new Date(), fetcher = fetch } = {}) {
  const key = cacheKeyFor(lat, lng);
  const now = today.getTime();
  const cached = readCache(key, now);
  if (cached) return { byDay: cached.byDay, years: cached.years, cached: true };

  const span = archiveSpan(today);
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    start_date: span.start,
    end_date: span.end,
    daily: 'temperature_2m_max,temperature_2m_min',
    temperature_unit: 'fahrenheit',
    timezone: 'UTC',
  });
  const res = await fetcher(`${ARCHIVE_URL}?${params}`);
  if (!res.ok) throw new Error('Could not load past weather for that place.');
  const data = await res.json();
  const d = data.daily || {};
  const byDay = averageByDay(d.time, d.temperature_2m_max, d.temperature_2m_min);
  if (!Object.keys(byDay).length) throw new Error('No past weather recorded for that place.');
  writeCache(key, { at: now, byDay, years: span.years });
  return { byDay, years: span.years, cached: false };
}


/* An event's location, as things the geocoder might actually know.

   Locations here are typed for humans — "225 West 34th Street, 2nd Floor, New
   York, NY 10001", "Mom's, Newport RI". Open-Meteo's geocoder knows places,
   not street addresses, so the street is dropped a piece at a time until
   something matches: the whole string first, then everything after the first
   comma, and so on down to the last part. A bare unit or ZIP fragment is no
   use as a place, so it is skipped. */
export function locationQueries(location) {
  const parts = String(location || '').split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const rest = parts.slice(i);
    // "2nd Floor", "Apt 4B", "10001" — nothing a map can find on its own.
    if (rest.length === 1 && /^(\d[\w-]*|(apt|apartment|suite|ste|unit|floor|fl|#)\b.*)$/i.test(rest[0])) continue;
    const q = rest.join(', ').replace(/\s+/g, ' ').trim();
    if (q && !out.includes(q)) out.push(q);
    // A trailing ZIP defeats a place-name geocoder that would otherwise know
    // the town — "New York, NY 10001" finds nothing, "New York, NY" finds it.
    const noZip = q.replace(/[,\s]+\d{5}(-\d{4})?$/, '').trim();
    if (noZip && noZip !== q && !out.includes(noZip)) out.push(noZip);
  }
  return out.slice(0, 6);
}

/* The event's location as coordinates, or null when nothing matches.
   `geocoder` is lib/weather's geocode, passed in so this stays testable. */
export async function resolvePlace(location, geocoder) {
  for (const q of locationQueries(location)) {
    let hits = [];
    try { hits = await geocoder(q); } catch { hits = []; }
    if (hits && hits.length) return { ...hits[0], query: q };
  }
  return null;
}

/* What the page asks for: typical weather for an event's location.

   /api/climate answers it with Google's geocoder, which knows street
   addresses. When that route isn't there — `npm run dev` serves the app but
   not the functions — this falls back to looking the place up and reading the
   archive straight from the browser, which is how lib/weather.js works
   anyway. Either way the answer is kept per location for a month. */
export async function fetchEventClimate(location, { fetcher = fetch, geocoder, today = new Date() } = {}) {
  const loc = String(location || '').trim();
  if (!loc) throw new Error('This event has no location yet.');
  const key = `loc:${loc.toLowerCase()}`;
  const now = today.getTime();
  const cached = readCache(key, now);
  if (cached) return { place: cached.place, byDay: cached.byDay, years: cached.years, cached: true };

  // The route's own answer, when it has one: a place nobody can find is not
  // going to be found by asking a second way.
  let body = null;
  let refused = null;
  try {
    const res = await fetcher(`/api/climate?location=${encodeURIComponent(loc)}`);
    const isJson = (res.headers?.get?.('content-type') || '').includes('application/json');
    if (res.ok && isJson) body = await res.json();
    else if (isJson) refused = (await res.json().catch(() => ({}))).error || 'Could not load past weather for that place.';
    // Anything else — the dev server's index.html, a gateway page — means the
    // route isn't answering, so the browser looks it up itself below.
  } catch { /* unreachable: same */ }
  if (refused) throw new Error(refused);

  if (!body) {
    const place = await resolvePlace(loc, geocoder);
    if (!place) throw new Error(`Could not find “${loc}” on the map.`);
    const normals = await fetchClimateNormals(place.lat, place.lng, { today, fetcher });
    body = { place, byDay: normals.byDay, years: normals.years };
  }

  writeCache(key, { at: now, ...body });
  return { ...body, cached: false };
}
