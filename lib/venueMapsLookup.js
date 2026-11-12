/* global process */
/* Following a Google Maps link to the place it names (server side).

   1. A short link (maps.app.goo.gl/…) is followed, one redirect at a time,
      to the full link — and only ever to a Google address, so the endpoint
      can't be pointed at anything else.
   2. The full link is read for the place's name, address and pin
      (src/lib/venueMaps.js).
   3. With a Maps key on the server, Google is asked for the rest — the
      address, phone number and website — from the Places API if the key has
      it, else the address alone from Geocoding. Without a key, or if Google
      says no, what the link itself said is what comes back. */

import { isGoogleHost, isMapsUrl, isShortMapsUrl, parseMapsUrl } from '../src/lib/venueMaps.js';

const MAX_HOPS = 6;
const fail = (status, message) => Object.assign(new Error(message), { status });

// The full Maps link a (possibly short) link leads to.
export async function resolveMapsUrl(url, { fetchImpl = fetch } = {}) {
  if (!isMapsUrl(url)) throw fail(400, 'That isn’t a Google Maps link');
  let current = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const u = new URL(current);
    if (u.protocol !== 'https:' || !isGoogleHost(u.hostname)) throw fail(400, 'That link leads somewhere other than Google Maps');
    // Google's cookie notice wraps the real link in ?continue=.
    if (u.hostname.startsWith('consent.')) {
      const next = u.searchParams.get('continue');
      if (!next) throw fail(502, 'Google Maps didn’t say where that link goes');
      current = next;
      continue;
    }
    if (!isShortMapsUrl(current) && parseMapsUrl(current)) return current;
    const res = await fetchImpl(current, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RallyVenueImport/1.0)', 'Accept-Language': 'en-US,en' } });
    const next = res.headers?.get?.('location');
    if (!(res.status >= 300 && res.status < 400) || !next) {
      if (!isShortMapsUrl(current)) return current;
      throw fail(502, 'Google Maps didn’t say where that link goes');
    }
    current = new URL(next, current).href;
  }
  throw fail(502, 'That link redirected too many times');
}

const placeFromNew = (p) => (p ? {
  name: p.displayName?.text || '', address: p.formattedAddress || '', phone: p.nationalPhoneNumber || p.internationalPhoneNumber || '',
  website: p.websiteUri || '', mapsUrl: p.googleMapsUri || '',
} : null);

// Places API (New): one text search, biased to the pin when there is one.
async function searchPlacesNew(parsed, key, fetchImpl) {
  const body = { textQuery: parsed.text, maxResultCount: 1 };
  if (parsed.lat !== null) body.locationBias = { circle: { center: { latitude: parsed.lat, longitude: parsed.lng }, radius: 500 } };
  const res = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return placeFromNew((await res.json())?.places?.[0]);
}

// Places API (the older one): find the place, then its details.
async function searchPlacesLegacy(parsed, key, fetchImpl) {
  let placeId = parsed.placeId;
  if (!placeId) {
    const find = new URL('https://maps.googleapis.com/maps/api/place/findplacefromtext/json');
    find.searchParams.set('input', parsed.text);
    find.searchParams.set('inputtype', 'textquery');
    find.searchParams.set('fields', 'place_id');
    if (parsed.lat !== null) find.searchParams.set('locationbias', `point:${parsed.lat},${parsed.lng}`);
    find.searchParams.set('key', key);
    const found = await (await fetchImpl(find)).json();
    placeId = found?.status === 'OK' ? found.candidates?.[0]?.place_id : '';
  }
  if (!placeId) return null;
  const det = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  det.searchParams.set('place_id', placeId);
  det.searchParams.set('fields', 'name,formatted_address,formatted_phone_number,website,url');
  det.searchParams.set('key', key);
  const data = await (await fetchImpl(det)).json();
  const r = data?.status === 'OK' ? data.result : null;
  return r ? { name: r.name || '', address: r.formatted_address || '', phone: r.formatted_phone_number || '', website: r.website || '', mapsUrl: r.url || '' } : null;
}

// Geocoding: the street address of a pin.
async function reverseGeocode(parsed, key, fetchImpl) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('latlng', `${parsed.lat},${parsed.lng}`);
  url.searchParams.set('key', key);
  const data = await (await fetchImpl(url)).json();
  return data?.status === 'OK' ? data.results?.[0]?.formatted_address || '' : '';
}

/* The place a link names: { name, address, phone, website, mapsUrl, source }.
   `source` says how much was found: 'places' (Google's own record),
   'geocode' (the link's name with a looked-up address) or 'link' (only what
   the link said). */
export async function lookupMapsLink(url, { fetchImpl = fetch, key = process.env.GOOGLE_MAPS_SERVER_KEY || process.env.VITE_GOOGLE_MAPS_EMBED_KEY } = {}) {
  const full = await resolveMapsUrl(url, { fetchImpl });
  const parsed = parseMapsUrl(full);
  if (!parsed) throw fail(422, 'That link doesn’t point at a place');
  const base = { name: parsed.name, address: parsed.address, phone: '', website: '', mapsUrl: full, source: 'link' };
  if (!key) return base;
  if (parsed.text || parsed.placeId) {
    for (const search of [searchPlacesNew, searchPlacesLegacy]) {
      if (search === searchPlacesNew && !parsed.text) continue;
      const place = await search(parsed, key, fetchImpl).catch(() => null);
      if (place?.name) return { ...base, ...place, name: place.name, address: place.address || base.address, mapsUrl: full, source: 'places' };
    }
  }
  if (!base.address && parsed.lat !== null) {
    const address = await reverseGeocode(parsed, key, fetchImpl).catch(() => '');
    if (address) return { ...base, address, source: 'geocode' };
  }
  return base;
}
