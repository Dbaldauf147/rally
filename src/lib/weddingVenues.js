/* Wedding venues — the places being considered, kept on the user doc as
   `weddingVenues` (an array) beside the guest list.

   A venue comes from a Gmail scan (api/wedding-venues.js) or is typed in.
   A scan never undoes what was typed: it fills fields that are still empty,
   moves the status forward (never back), keeps the latest contact date, and
   adds the threads it found. A venue that was deleted is remembered by key in
   `weddingVenueDismissed`, so the next scan doesn't bring it back. */

export const VENUE_STATUSES = ['Researching', 'Inquired', 'Replied', 'Tour scheduled', 'Toured', 'Quote received', 'Booked', 'Not a fit'];

export const VENUE_FIELDS = [
  { key: 'name', label: 'Venue' },
  { key: 'status', label: 'Status' },
  { key: 'contactName', label: 'Contact' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'website', label: 'Website' },
  { key: 'location', label: 'Location', wide: true },
  { key: 'price', label: 'Pricing', wide: true },
  { key: 'capacity', label: 'Capacity' },
  { key: 'availability', label: 'Availability' },
  { key: 'nextStep', label: 'Next step', wide: true },
  { key: 'lastContactDate', label: 'Last contact', type: 'date' },
  { key: 'notes', label: 'Notes', wide: true, multiline: true },
];

const TEXT_KEYS = ['name', 'contactName', 'email', 'phone', 'website', 'location', 'price', 'capacity', 'availability', 'nextStep', 'summary', 'notes'];

const str = (v) => (typeof v === 'string' ? v.trim() : '');

export function normalizeVenue(v, { id } = {}) {
  const out = { id: str(v?.id) || id || newVenueId() };
  for (const k of TEXT_KEYS) out[k] = str(v?.[k]);
  out.email = out.email.toLowerCase();
  out.status = VENUE_STATUSES.includes(v?.status) ? v.status : 'Researching';
  out.lastContactDate = /^\d{4}-\d{2}-\d{2}$/.test(str(v?.lastContactDate)) ? str(v.lastContactDate) : '';
  out.threadIds = [...new Set((Array.isArray(v?.threadIds) ? v.threadIds : []).map(str).filter(Boolean))];
  out.source = v?.source === 'gmail' ? 'gmail' : 'manual';
  // Starred to keep at the top of the table, and the values of the columns
  // added by hand (lib/venueTable.js), by column key.
  out.starred = v?.starred === true;
  out.custom = {};
  if (v?.custom && typeof v.custom === 'object') {
    for (const [k, val] of Object.entries(v.custom)) if (/^c_[a-z0-9]+$/.test(k) && str(val)) out.custom[k] = str(val);
  }
  return out;
}

export function newVenueId() {
  return `venue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// "The Foundry at Huntington, LLC" and "the foundry" are the same place.
export function venueNameKey(name) {
  return str(name).toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(the|llc|inc|co|events?|venue|weddings?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A free mail domain says nothing about which venue it is, so only the exact
// address counts there. A listing site relays every venue's leads from the
// same few addresses, so not even that.
const FREE_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'me.com']);
const LISTING_DOMAINS = new Set(['theknot.com', 'weddingwire.com', 'zola.com', 'herecomestheguide.com', 'tripleseat.com',
  'honeybook.com', 'perfectvenue.com', 'weddingspot.com', 'peerspace.com']);
const domainOf = (email) => str(email).toLowerCase().split('@')[1] || '';
const isListing = (d) => [...LISTING_DOMAINS].some((l) => d === l || d.endsWith(`.${l}`));

// Two records are one venue when the names match, or they share the venue's
// own email address or company email domain.
export function sameVenue(a, b) {
  const ka = venueNameKey(a?.name);
  const kb = venueNameKey(b?.name);
  if (ka && kb && (ka === kb || (ka.length >= 6 && kb.length >= 6 && (ka.includes(kb) || kb.includes(ka))))) return true;
  const ea = str(a?.email).toLowerCase();
  const eb = str(b?.email).toLowerCase();
  if (!ea || !eb) return false;
  const da = domainOf(ea);
  if (isListing(da)) return false;
  if (ea === eb) return true;
  return !FREE_DOMAINS.has(da) && da === domainOf(eb);
}

const statusRank = (s) => VENUE_STATUSES.indexOf(s);
// "Not a fit" can come at any point, so it isn't "further" than Booked by rank —
// but a scan saying a venue declined does replace an earlier stage.
function laterStatus(current, scanned) {
  if (!VENUE_STATUSES.includes(scanned)) return current;
  if (current === 'Booked' || current === 'Not a fit') return current;
  if (scanned === 'Not a fit') return scanned;
  return statusRank(scanned) > statusRank(current) ? scanned : current;
}

/* Fold scan results into the saved list. Returns the new list and the names
   added and updated, for the message after a scan. */
export function mergeScannedVenues(existing, scanned, dismissed = []) {
  const list = (Array.isArray(existing) ? existing : []).map((v) => normalizeVenue(v));
  const gone = new Set((dismissed || []).map(venueNameKey).filter(Boolean));
  const added = [];
  const updated = [];
  for (const raw of Array.isArray(scanned) ? scanned : []) {
    const found = normalizeVenue({ ...raw, source: 'gmail' });
    if (!found.name) continue;
    if (gone.has(venueNameKey(found.name))) continue;
    const at = list.findIndex((v) => sameVenue(v, found));
    if (at < 0) {
      list.push(found);
      added.push(found.name);
      continue;
    }
    const cur = list[at];
    const next = { ...cur };
    for (const k of TEXT_KEYS) if (!next[k] && found[k]) next[k] = found[k];
    next.status = laterStatus(cur.status, found.status);
    if (found.lastContactDate > (cur.lastContactDate || '')) {
      next.lastContactDate = found.lastContactDate;
      // A newer email's next step and summary are the current ones.
      if (found.nextStep && cur.source === 'gmail') next.nextStep = found.nextStep;
      if (found.summary) next.summary = found.summary;
    }
    next.threadIds = [...new Set([...cur.threadIds, ...found.threadIds])];
    if (JSON.stringify(next) !== JSON.stringify(cur)) {
      list[at] = next;
      updated.push(next.name);
    }
  }
  return { list, added, updated };
}

// Newest contact first; venues with no date after, by name.
export function sortVenues(list) {
  return [...(list || [])].sort((a, b) => {
    const d = (b.lastContactDate || '').localeCompare(a.lastContactDate || '');
    return d || (a.name || '').localeCompare(b.name || '');
  });
}

export function gmailThreadUrl(threadId, account) {
  const who = account ? encodeURIComponent(account) : '0';
  return `https://mail.google.com/mail/u/${who}/#all/${encodeURIComponent(threadId)}`;
}
