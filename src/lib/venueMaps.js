/* Google Maps links → venues.

   A link shared from Google Maps (the app's Share button, or the address bar)
   names a place. This reads what the link itself says — the place's name,
   often its address, and where it is — so a venue can be added from it.
   Short links (maps.app.goo.gl/…) say nothing until they're followed, which
   the server does (lib/venueMapsLookup.js); it also asks Google for the
   phone number and website when it can.

   Pure, and shared by the page and the server. */

const str = (v) => (typeof v === 'string' ? v.trim() : '');

const GOOGLE_HOST = /^(?:www\.|maps\.|m\.)?google\.(?:com|[a-z]{2,3}|com?\.[a-z]{2})$/;

function toUrl(raw) {
  const s = str(raw);
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

// A short share link: nothing in it but a code, so it has to be followed.
export function isShortMapsUrl(raw) {
  const u = toUrl(raw);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  return host === 'maps.app.goo.gl' || (host === 'goo.gl' && u.pathname.startsWith('/maps/')) || (host === 'g.co' && u.pathname.startsWith('/kgs/'));
}

// Any Google Maps link, short or full.
export function isMapsUrl(raw) {
  const u = toUrl(raw);
  if (!u) return false;
  if (isShortMapsUrl(raw)) return true;
  const host = u.hostname.toLowerCase();
  if (!GOOGLE_HOST.test(host)) return false;
  return host.startsWith('maps.') || u.pathname === '/maps' || u.pathname.startsWith('/maps/');
}

// A Google address the server may follow a redirect to (and nothing else).
export function isGoogleHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'g.co' || GOOGLE_HOST.test(host) || /^consent\.google\.[a-z.]+$/.test(host);
}

/* The Maps links in a piece of pasted text, in order, with whatever was
   written on the lines just above each (the Share sheet puts the place's
   name there): [{ url, hint }]. Trailing punctuation isn't part of a link. */
export function extractMapsLinks(text) {
  const out = [];
  const seen = new Set();
  let above = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const urls = line.match(/(?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\/[^\s<>"']*/gi) || [];
    const links = urls.map((u) => u.replace(/[),.;!?]+$/, '')).filter(isMapsUrl).map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`));
    if (!links.length) {
      if (line.trim()) above.push(line.trim()); else above = [];
      continue;
    }
    const before = line.slice(0, line.search(/(?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\//i)).trim();
    const hint = [...above, before].filter(Boolean).join(', ');
    links.forEach((url, i) => {
      if (seen.has(url)) return;
      seen.add(url);
      out.push({ url, hint: i === 0 ? hint : '' });
    });
    above = [];
  }
  return out;
}

const COORDS = /^\s*-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?\s*$/;
const decode = (s) => {
  try { return decodeURIComponent(String(s || '').replace(/\+/g, ' ')).trim(); } catch { return String(s || '').replace(/\+/g, ' ').trim(); }
};
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/* "Oheka Castle Hotel & Estate, 135 W Gate Dr, Huntington, NY 11743" →
   the name and the address. A place text with no comma is all name; one
   that starts with a street number is all address. */
export function splitPlaceText(text) {
  const s = str(text).replace(/\s+/g, ' ');
  if (!s || COORDS.test(s)) return { name: '', address: '' };
  const at = s.indexOf(',');
  if (at < 0) return { name: s, address: '' };
  const first = s.slice(0, at).trim();
  if (/^\d+\s+\S/.test(first)) return { name: '', address: s };
  return { name: first, address: s.slice(at + 1).trim() };
}

/* What a full Google Maps link says: { name, address, text, lat, lng,
   placeId } — any of them blank/null when the link doesn't carry it — or
   null when it isn't a Maps link for a place (a short link, directions, or
   just a patch of map). */
export function parseMapsUrl(raw) {
  const u = toUrl(raw);
  if (!u || !isMapsUrl(raw) || isShortMapsUrl(raw)) return null;
  const path = u.pathname;
  let text = '';
  const place = path.match(/\/maps\/(?:place|search)\/([^/]+)/);
  if (place) text = decode(place[1]);
  if (!text) text = decode(u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('destination') || '');
  if (/^(?:loc|place_id):/i.test(text)) text = '';
  // Where the pin is: the place's own point (!3d…!4d…) beats the map's centre (@…).
  let lat = null;
  let lng = null;
  const pin = raw.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const centre = path.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const ll = (u.searchParams.get('ll') || u.searchParams.get('center') || (COORDS.test(text) ? text : '')).match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  const got = pin || centre || ll;
  if (got) { lat = num(got[1]); lng = num(got[2]); }
  if (lat !== null && (Math.abs(lat) > 90 || Math.abs(lng) > 180)) { lat = null; lng = null; }
  const placeId = str(u.searchParams.get('query_place_id') || u.searchParams.get('place_id'));
  const { name, address } = splitPlaceText(text);
  if (!name && !address && !placeId && lat === null) return null;
  return { name, address, text: COORDS.test(text) ? '' : text, lat, lng, placeId };
}

// A link worth keeping on a venue: any web address, tidied; else ''.
export function cleanMapsUrl(raw) {
  const u = toUrl(raw);
  if (!u || !u.hostname.includes('.')) return '';
  return u.href.length <= 1000 ? u.href : '';
}

// A Google Maps search for a venue that has no link of its own.
export function mapsSearchUrl(venue) {
  const q = [venue?.name, venue?.location].map(str).filter(Boolean).join(', ');
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : '';
}

/* A looked-up place as the fields of a venue. `hint` is what was written
   above the link when it was pasted, used when the link gave no name. */
export function venueFieldsFromPlace(place, { url = '', hint = '' } = {}) {
  const fromHint = splitPlaceText(hint);
  return {
    name: str(place?.name) || fromHint.name,
    location: str(place?.address) || fromHint.address,
    phone: str(place?.phone),
    website: str(place?.website),
    mapsUrl: cleanMapsUrl(url) || cleanMapsUrl(place?.mapsUrl),
  };
}
