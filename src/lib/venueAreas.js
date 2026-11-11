/* The locations the wedding could be in ("North Fork", "Newport, RI",
   "Brooklyn"…), and which of them each venue falls in.

   Kept on the user doc as `weddingVenueAreas: [{ id, name, keywords: [..] }]`.
   A venue matches a location when its address (else its name) contains one
   of the location's keywords as whole words — or the location's own name,
   up to its first comma ("Mystic" for "Mystic, CT"). The longest keyword
   that hits wins, so "East Hampton" beats "Hampton"; a tie goes to the
   location higher in the list.

   A venue can also be put in a location by hand (`venue.area` = its id), or
   marked as in none of them (NO_AREA) so it stops showing a warning. A
   venue with neither is matched automatically, and one that matches
   nothing is flagged. Pure, so it can be tested without React. */

export const NO_AREA = '__none';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const words = (s) => ` ${String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;

export function newAreaId() {
  return `area-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Keywords typed as "Orient, Southold; Greenport\nCutchogue" → a clean list.
export function parseKeywords(text) {
  const seen = new Set();
  return String(text || '').split(/[,;\n]+/).map((k) => k.trim()).filter((k) => {
    const key = k.toLowerCase();
    if (!k || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeAreas(raw) {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).map((a) => ({
    id: str(a?.id) || newAreaId(),
    name: str(a?.name),
    keywords: Array.isArray(a?.keywords) ? parseKeywords(a.keywords.join('\n')) : parseKeywords(a?.keywords),
  })).filter((a) => a.name && !seen.has(a.id) && seen.add(a.id));
}

// Every phrase that puts a venue in this location, as padded words.
export function areaTerms(area) {
  const own = str(area?.name).split(',')[0];
  return [...new Set([own, ...(area?.keywords || [])].map(words).filter((t) => t.trim()))];
}

// The best location for a piece of text: { area, term } or null.
function bestMatch(text, areas) {
  const hay = words(text);
  if (!hay.trim()) return null;
  let best = null;
  for (const area of areas) {
    for (const term of areaTerms(area)) {
      if (hay.includes(term) && (!best || term.length > best.term.length)) best = { area, term: term.trim() };
    }
  }
  return best;
}

/* Where a venue sits:
     { area, how: 'manual' }   picked by hand
     { area, how: 'auto', term }  matched on its address or name
     { area: null, how: 'none' }  marked as in none of the locations
     { area: null, how: 'unmapped' }  nothing matched — the warning case
   With no locations set up at all, every venue is { area: null, how: 'off' }. */
export function venueArea(venue, areas) {
  if (!areas?.length) return { area: null, how: 'off' };
  const pick = str(venue?.area);
  if (pick === NO_AREA) return { area: null, how: 'none' };
  const chosen = pick && areas.find((a) => a.id === pick);
  if (chosen) return { area: chosen, how: 'manual' };
  const hit = bestMatch(venue?.location, areas) || bestMatch(venue?.name, areas);
  return hit ? { area: hit.area, how: 'auto', term: hit.term } : { area: null, how: 'unmapped' };
}

// The venues that need attention: nothing matched and nothing picked.
export const unmappedVenues = (venues, areas) => (areas?.length ? (venues || []).filter((v) => venueArea(v, areas).how === 'unmapped') : []);

// The location's name for sorting and searching ('' when there's none).
export const areaName = (venue, areas) => venueArea(venue, areas).area?.name || '';
