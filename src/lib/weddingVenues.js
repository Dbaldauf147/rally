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
  { key: 'venueFeeLow', label: 'Venue fee low', type: 'money' },
  { key: 'venueFeeHigh', label: 'Venue fee high', type: 'money' },
  { key: 'perPersonLow', label: 'Per person low', type: 'money' },
  { key: 'perPersonHigh', label: 'Per person high', type: 'money' },
  { key: 'allInclusive', label: 'All-inclusive', type: 'yesno' },
  { key: 'capacity', label: 'Capacity' },
  { key: 'availability', label: 'Availability' },
  { key: 'nextStep', label: 'Next step', wide: true },
  { key: 'lastContactDate', label: 'Last contact', type: 'date' },
  { key: 'notes', label: 'Notes', wide: true, multiline: true },
];

const TEXT_KEYS = ['name', 'contactName', 'email', 'phone', 'website', 'location', 'price', 'allInclusive', 'capacity', 'availability', 'nextStep', 'summary', 'notes'];

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/* ── Prices ──
   Two ranges, each a low and a high in whole dollars: the venue fee (site or
   rental fee plus any admin fee — the flat total, whatever the head count)
   and the price per person (per plate). Kept as "$18,000"-style text so the
   cells read and filter as money; sorted by their numbers. */
export const MONEY_KEYS = ['venueFeeLow', 'venueFeeHigh', 'perPersonLow', 'perPersonHigh'];

// "$18k", "18,000", "$12.5K", "165" → 18000 / 12500 / 165; else null.
export function parseMoney(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  const m = String(v ?? '').replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)\s*(k|m)?\b/i);
  if (!m) return null;
  const unit = (m[2] || '').toLowerCase();
  const n = Number(m[1]) * (unit === 'k' ? 1000 : unit === 'm' ? 1e6 : 1);
  return Number.isFinite(n) ? Math.round(n) : null;
}
export const formatMoney = (n) => (n === null || n === undefined || n === '' || !Number.isFinite(Number(n)) ? '' : `$${Math.round(Number(n)).toLocaleString('en-US')}`);
export const cleanMoney = (v) => formatMoney(parseMoney(v));

// "$145–$185", "145 - 185", "$10k to $15k" → [145, 185]; one amount → [n, n].
export function parseMoneyRange(v) {
  const s = String(v ?? '').replace(/,/g, '');
  const amounts = [...s.matchAll(/\$?\s*\d+(?:\.\d+)?\s*(?:k|m)?\b/gi)].map((m) => parseMoney(m[0])).filter((n) => n !== null);
  if (!amounts.length) return null;
  return [Math.min(...amounts), Math.max(...amounts)];
}

const PER_PERSON = /^\s*\+{0,2}\s*(?:(?:\/\s*|per\s+)(?:pp|person|plate|guest|head|pax)\b|pp\b|a\s+(?:person|head|plate)\b)/i;
const ADMIN = /^\s*(?:in\s+)?(?:admin(?:istrative)?|administration)\b/i;
const MONEY_RANGE = /\$\s*\d[\d,]*(?:\.\d+)?\s*[km]?\b(?:\s*(?:-|–|—|to)\s*\$?\s*\d[\d,]*(?:\.\d+)?\s*[km]?\b)?/gi;

/* The two ranges read out of a free-text quote: every dollar amount (or
   "$a–$b" range) followed by "/pp", "per person", "per plate"… is per
   person, an admin fee is added onto the venue fee, an hourly or other rate
   is skipped, and the rest are the venue fee. Returns the four cells. */
export function rangesFromText(text) {
  const out = { venueFeeLow: '', venueFeeHigh: '', perPersonLow: '', perPersonHigh: '' };
  const fee = [];
  const pp = [];
  const admin = [];
  const s = String(text || '');
  for (const m of s.matchAll(MONEY_RANGE)) {
    const range = parseMoneyRange(m[0]);
    if (!range) continue;
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 24);
    if (PER_PERSON.test(after)) pp.push(...range);
    // The admin fee is part of the venue fee: it's added on, not a low end.
    else if (ADMIN.test(after)) admin.push(range[0]);
    // Some other rate ("$90/lane/hr", "$500 per hour") is neither range.
    else if (/^\s*(?:\/|per\b|an?\s+hour|hourly)/i.test(after)) continue;
    else fee.push(...range);
  }
  const extra = admin.reduce((sum, n) => sum + n, 0);
  if (fee.length) Object.assign(out, { venueFeeLow: formatMoney(Math.min(...fee) + extra), venueFeeHigh: formatMoney(Math.max(...fee) + extra) });
  else if (extra) Object.assign(out, { venueFeeLow: formatMoney(extra), venueFeeHigh: formatMoney(extra) });
  if (pp.length) Object.assign(out, { perPersonLow: formatMoney(Math.min(...pp)), perPersonHigh: formatMoney(Math.max(...pp)) });
  return out;
}

/* Whether the quote is all-inclusive (food, drink, staff and rentals in one
   price) or the venue is a rental you cater yourself. "Yes" / "No", or blank
   when nobody has said; anything else typed is kept as written ("Partly"). */
export function normalizeAllInclusive(v) {
  const s = typeof v === 'boolean' ? (v ? 'yes' : 'no') : str(v);
  const t = s.toLowerCase().replace(/[.!]+$/, '');
  if (!t) return '';
  if (/^(y|yes|true|x|✓|✔|all[- ]?inclusive|inclusive|included)$/.test(t)) return 'Yes';
  if (/^(n|no|false|not all[- ]?inclusive|not inclusive|rental|venue only|a la carte|à la carte)$/.test(t)) return 'No';
  return s;
}

export function normalizeVenue(v, { id } = {}) {
  const out = { id: str(v?.id) || id || newVenueId() };
  for (const k of TEXT_KEYS) out[k] = str(v?.[k]);
  out.email = out.email.toLowerCase();
  out.allInclusive = normalizeAllInclusive(v?.allInclusive);
  for (const k of MONEY_KEYS) out[k] = cleanMoney(v?.[k]);
  // A venue saved before the ranges existed gets them from what it had: the
  // separate venue-price and per-plate notes, else the pricing text. Only
  // then — once the range cells are saved, a cleared cell stays cleared.
  if (v && MONEY_KEYS.every((k) => v[k] === undefined)) {
    const perPlate = str(v.perPlate);
    const from = [str(v.venueFee), perPlate && (/per|\/|pp/i.test(perPlate) ? perPlate : `${perPlate} per person`)].filter(Boolean).join(' ; ') || str(v.price);
    Object.assign(out, rangesFromText(from));
  }
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
    for (const k of [...TEXT_KEYS, ...MONEY_KEYS]) if (!next[k] && found[k]) next[k] = found[k];
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
