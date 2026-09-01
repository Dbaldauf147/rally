// The doctor list — who was seen for what, and how to reach them again.
//
// Kept pure (no React, no Firestore) so the shaping, searching and grouping can
// be unit-tested; DoctorsPage.jsx owns the reading and writing, storing the
// list on the owner's own user doc the way Travel List and PTO do.
//
// The records are half address book and half medical history, and the two
// halves don't line up: a row can be a standing doctor with no issue attached
// (the gastroenterologist), an issue with no doctor at all (a neck sprain that
// resolved on its own), or both at once. Nothing here requires a doctor or an
// issue, and the display leans on whichever one a row actually has.

export const STATUS = { TREATING: 'treating', RESOLVED: 'resolved', NONE: 'none' };

// Order is the running order of the page: what's live now, then standing care,
// then history. Sorting and the filter pills both read it, so the two can't
// disagree about what comes first.
export const STATUS_ORDER = [STATUS.TREATING, STATUS.NONE, STATUS.RESOLVED];

export const STATUS_META = {
  [STATUS.TREATING]: { label: 'Being treated', heading: 'Being treated now' },
  [STATUS.NONE]: { label: 'Ongoing', heading: 'Ongoing care' },
  [STATUS.RESOLVED]: { label: 'Resolved', heading: 'Resolved' },
};

export const statusLabel = (s) => STATUS_META[s]?.label || STATUS_META[STATUS.NONE].label;
export const statusHeading = (s) => STATUS_META[s]?.heading || STATUS_META[STATUS.NONE].heading;

/* The spreadsheet's "Resolved?" column, which held free text rather than a
   flag: "Resolved", "Being Treated", or "-" for a doctor with no open issue.
   Anything unrecognised becomes NONE rather than being dropped, so a typo
   downgrades a row's grouping instead of losing it. */
export function parseStatus(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || s === '-' || s === '—') return STATUS.NONE;
  if (s.startsWith('resolved')) return STATUS.RESOLVED;
  if (s.includes('treat')) return STATUS.TREATING;
  return STATUS.NONE;
}

// Every text field on a record, in the order the original sheet had them. The
// add/edit form and the CSV export both build themselves from this, so a new
// field is added in one place.
export const FIELDS = [
  { key: 'doctor', label: 'Doctor' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'type', label: 'Type', placeholder: 'Skin, Dentist, Primary Physician…' },
  { key: 'issue', label: 'Issue' },
  { key: 'currentMeds', label: 'Current Meds' },
  { key: 'previousMeds', label: 'Previous Meds' },
  { key: 'place', label: 'Place' },
  { key: 'location', label: 'Location', long: true },
  { key: 'cadence', label: 'Cadence', placeholder: 'Every 6 months' },
  { key: 'link', label: 'Link', type: 'url', long: true },
  { key: 'notes', label: 'Notes', long: true },
];

const FIELD_KEYS = FIELDS.map((f) => f.key);

let seq = 0;
export function makeId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  seq += 1;
  return `d${Date.now().toString(36)}${seq}`;
}

/* One record, with every field present as a string.

   Missing beats absent here: the form binds an input per field, and a record
   whose `notes` is undefined would make that input uncontrolled and warn. */
export function normalizeEntry(raw) {
  const out = { id: String(raw?.id || makeId()) };
  FIELD_KEYS.forEach((k) => { out[k] = String(raw?.[k] ?? '').trim(); });
  out.status = parseStatus(raw?.status);
  return out;
}

export function normalizeList(raw) {
  const entries = Array.isArray(raw?.entries) ? raw.entries : Array.isArray(raw) ? raw : [];
  return { entries: entries.map(normalizeEntry) };
}

// A row worth keeping. Somebody who recorded only "Levator spasm" still has a
// record; somebody who filled in nothing does not.
export const hasContent = (e) => FIELD_KEYS.some((k) => e[k]);

/* What a row is called. The doctor's name when there is one, otherwise the
   place, the issue, or the speciality — in that order, because that's the
   descending order of how specifically each one identifies the row. */
export function entryTitle(e) {
  return e.doctor || e.place || e.issue || e.type || 'Untitled';
}

// The title already shows one of these; the subtitle shows the next one down
// so a row titled by its issue doesn't repeat the issue underneath.
export function entrySubtitle(e) {
  const parts = [e.doctor ? e.type : '', e.doctor && e.place ? e.place : ''].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return e.doctor ? '' : [e.type, e.place].filter((p) => p && p !== entryTitle(e)).join(' · ');
}

/* The detail rows a card shows, in reading order.

   Contact details are left out because the card turns those into buttons. The
   issue is left out when it is already the card's title — a row headed ISSUE
   repeating the heading above it word for word is pure noise, and rows with
   nothing but an issue are common in this list. */
const DETAIL_ROWS = ['issue', 'currentMeds', 'previousMeds', 'cadence', 'notes'];

export function cardRows(entry) {
  const title = entryTitle(entry);
  return DETAIL_ROWS.filter((k) => entry[k] && !(k === 'issue' && entry.issue === title));
}

/* Free-text search across everything, because the thing you remember about a
   doctor is rarely their name — it's the street, the drug, or the complaint. */
export function matchesQuery(entry, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [...FIELD_KEYS.map((k) => entry[k]), statusLabel(entry.status)].join(' ').toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

// Alphabetical within a status group, by whatever the row is titled by, so the
// list stays in a predictable order as rows are added and edited.
const byTitle = (a, b) => entryTitle(a).localeCompare(entryTitle(b), undefined, { sensitivity: 'base' });

/* The visible list, grouped for rendering.

   Returns every status in STATUS_ORDER that has rows, so an empty group simply
   doesn't render rather than leaving a bare heading behind. */
export function groupByStatus(entries, { query = '', status = 'all' } = {}) {
  const visible = entries
    .filter((e) => (status === 'all' || e.status === status) && matchesQuery(e, query));
  return STATUS_ORDER
    .map((s) => ({ status: s, entries: visible.filter((e) => e.status === s).sort(byTitle) }))
    .filter((g) => g.entries.length > 0);
}

export function countByStatus(entries) {
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]));
  entries.forEach((e) => { if (counts[e.status] != null) counts[e.status] += 1; });
  return counts;
}

// --- links out -------------------------------------------------------------

// Phone numbers are recorded however they were written down; tel: wants only
// the dialable characters.
export function telHref(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : null;
}

export function mailHref(email) {
  const e = String(email || '').trim();
  return e.includes('@') ? `mailto:${e}` : null;
}

// An address is stored as written, not as coordinates, so the most useful
// thing to do with it is hand it to a map search.
export function mapHref(location) {
  const l = String(location || '').trim();
  return l ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l)}` : null;
}

// Only http(s) links are followed. A pasted `javascript:` URL would otherwise
// become a clickable script on a page the owner trusts.
export function safeLink(link) {
  const l = String(link || '').trim();
  return /^https?:\/\//i.test(l) ? l : null;
}

// Long URLs (the pasted search links are hundreds of characters) are unreadable
// in full and push the card wide; the host alone says where it goes.
export function linkLabel(link) {
  const l = safeLink(link);
  if (!l) return '';
  try {
    return new URL(l).hostname.replace(/^www\./, '');
  } catch {
    return l;
  }
}

/* The list as first recorded, used only when the account has none saved yet.

   Transcribed from the original spreadsheet. Two repairs were made to the text
   and nothing else: the dental address had lost the separators between its
   street, city and state, and rows carrying only a status keep their issue in
   the issue column. Medication spellings are left exactly as they were written
   — silently "correcting" a drug name in someone's medical notes is not this
   file's business. */
export function seedDoctors() {
  const rows = [
    { type: 'Gastroenterologist', status: '-' },
    {
      doctor: 'Dr. Annemarie Uliasz, MD',
      type: 'Skin',
      status: '-',
      link: 'https://www.google.com/search?q=angular+cheilitis&rlz=1CDGOYI_enUS713US713&hl=en-US&sxsrf=ALiCzsYhhkFCdDy41mggoQGk2JkcdQctIQ%3A1659798521829&ei=-YPuYsaUMouliLMPp9yFsAk&oq=angular+&gs_lcp=ChNtb2JpbGUtZ3dzLXdpei1zZXJwEAEYADIECAAQQzIKCAAQsQMQgwEQQzIECAAQQzIHCAAQsQMQQzIHCAAQsQMQQzIECAAQQzIICAAQgAQQsQMyBwgAELEDEEM6DQguEMcBENEDEOoCECc6BwguEOoCECc6BwgjEOoCECc6BAguECc6BAgjECc6EQguEIAEELEDEIMBEMcBENEDOggILhCxAxCDAToLCC4QsQMQgwEQ1AI6CwgAEIAEELEDEIMBOgsILhCABBCxAxCDAToECC4QQzoECAAQAzoKCC4QsQMQgwEQQzoNCC4QxwEQ0QMQ1AIQQzoHCC4QsQMQQzoICC4QgAQQsQNKBAhBGABQ7hBYjRpg8yRoAnABeACAAb8BiAHZCZIBAzAuOJgBAKABAbABD8ABAQ&sclient=mobile-gws-wiz-serpp',
    },
    {
      doctor: 'Sanjay Jobanputra',
      email: 'drj.ccrscny@gmail.com',
      type: 'Colorectal',
      status: 'Resolved',
      issue: 'Anal Fissure',
      currentMeds: 'Diltiazem 2% Lidocaine 5% (Metamusicil too)',
    },
    {
      doctor: 'Mount Sinai Doctors - Williamsburg',
      type: 'Primary Physician',
      status: '-',
      place: 'Mount Sinai Doctors - Williamsburg',
      location: '135 N 7th St, Brooklyn, NY 11211',
      cadence: 'Every 2 year(s)',
      notes: 'Annual Medical (Last Friday in April)',
    },
    {
      type: 'Dentist',
      status: 'Resolved',
      issue: 'Angular Cheilitis',
      currentMeds: 'Terrasil',
      place: '34th St Dental',
      location: '225 West 35th Street, 2nd Floor, New York, NY 10001',
      cadence: 'Every 6 months',
    },
    {
      doctor: 'Dr. Matthew Kim, MD (ENT)',
      type: 'Ear',
      status: 'Resolved',
      issue: 'Eczema',
      currentMeds: 'Fluocinolone Acetonide',
      location: '10 Union Sq E, Ste 5B, New York, NY 10003',
      cadence: 'Every 1 year(s)',
    },
    {
      doctor: 'Sochulak, Stephen',
      type: 'Skin',
      status: 'Resolved',
      issue: 'Jock itch (tinea cruris)',
      place: 'City MD Williamsburg',
    },
    {
      status: 'Resolved',
      issue: 'Plantar fasciitis (left foot)',
      currentMeds: 'Sandals with arch support did it',
    },
    { status: 'Being Treated', issue: 'Plantar fasciitis (right foot): Happened second' },
    { status: 'Resolved', issue: 'Neck sprain' },
    { status: 'Resolved', issue: 'Levator spasm' },
  ];
  // Fixed ids so a re-seed can't produce a second copy of the same row.
  return normalizeList({ entries: rows.map((r, i) => ({ ...r, id: `seed-${i + 1}` })) });
}
