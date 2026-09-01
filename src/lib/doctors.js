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
//
// The page is organised by type, and the types are a list the owner edits
// rather than whatever strings happen to be typed into the records. That's why
// the stored document is `{ types, entries }` and not just an array: the order
// of the headings is a thing you can arrange, and renaming a type has to carry
// every record using it along with it.

import {
  normalizeFieldDefs, newFieldId, coerceCustomValue, formatCustomValue,
} from './customFields';

export const STATUS = { TREATING: 'treating', RESOLVED: 'resolved', NONE: 'none' };

// Status is no longer a heading — it's a badge on the card and a filter above
// the list. This order drives the filter pills.
export const STATUS_ORDER = [STATUS.TREATING, STATUS.NONE, STATUS.RESOLVED];

export const STATUS_LABELS = {
  [STATUS.TREATING]: 'Being treated',
  [STATUS.NONE]: 'Ongoing',
  [STATUS.RESOLVED]: 'Resolved',
};

export const statusLabel = (s) => STATUS_LABELS[s] || STATUS_LABELS[STATUS.NONE];

// "Ongoing" is the resting state of a standing doctor. Badging it would put a
// label on most of the page and say nothing, so only the two that are news show.
export const showsStatusBadge = (s) => s === STATUS.TREATING || s === STATUS.RESOLVED;

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

// Rows with no type at all — the sprains and the plantar fasciitis, which were
// never anybody's speciality. They group under their own heading, last.
export const NO_TYPE = '';
export const NO_TYPE_LABEL = 'No type';
export const typeHeading = (type) => type || NO_TYPE_LABEL;

// Every text field on a record, in the order the original sheet had them. The
// add/edit form builds itself from this, so a new field is added in one place.
// `type` is absent on purpose: it's chosen from the managed list, not typed
// free-hand alongside the rest.
export const FIELDS = [
  { key: 'doctor', label: 'Doctor' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'issue', label: 'Issue' },
  { key: 'currentMeds', label: 'Current Meds' },
  { key: 'previousMeds', label: 'Previous Meds' },
  { key: 'place', label: 'Place' },
  { key: 'location', label: 'Location', long: true },
  { key: 'cadence', label: 'Cadence', placeholder: 'Every 6 months' },
  { key: 'link', label: 'Link', type: 'url', long: true },
  { key: 'notes', label: 'Notes', long: true },
];

// `type` still lives on the record and still has to be normalized and searched
// like any other text, it just isn't rendered as a free-text input.
const FIELD_KEYS = [...FIELDS.map((f) => f.key), 'type'];

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
  // Values for columns the owner added. Kept as stored — coercing needs the
  // field definition, which lives on the list and not on the record.
  out.custom = (raw?.custom && typeof raw.custom === 'object' && !Array.isArray(raw.custom))
    ? { ...raw.custom }
    : {};
  return out;
}

// Type names are compared case-insensitively so "skin" and "Skin" can't become
// two headings, but the casing that was typed first is the one kept.
export const sameType = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function dedupeTypes(names) {
  const out = [];
  names.forEach((raw) => {
    const name = String(raw ?? '').trim();
    if (name && !out.some((t) => sameType(t, name))) out.push(name);
  });
  return out;
}

/* The stored document.

   Any type a record uses but the list has lost is appended rather than
   silently swallowing that record into "No type" — the list decides the order
   of the headings, but it never decides which records exist. */
export function normalizeList(raw) {
  const rawEntries = Array.isArray(raw?.entries) ? raw.entries : Array.isArray(raw) ? raw : [];
  const entries = rawEntries.map(normalizeEntry);
  const declared = Array.isArray(raw?.types) ? raw.types : [];
  const used = entries.map((e) => e.type).filter(Boolean);
  return { types: dedupeTypes([...declared, ...used]), fields: normalizeFieldDefs(raw?.fields), entries };
}

// A row worth keeping. Somebody who recorded only "Levator spasm" still has a
// record; somebody who filled in nothing does not.
export const hasContent = (e) => FIELD_KEYS.some((k) => e[k]);

/* What a row is called. The doctor's name when there is one, otherwise the
   place, the issue, or the speciality — in that order, because that's the
   descending order of how specifically each one identifies the row.

   `omit` is the heading the card already sits under. A card headed
   "Gastroenterologist" inside a "Gastroenterologist" group says nothing twice,
   so that candidate is skipped and the row admits what it really is: a
   speciality nobody has been found for yet. */
export function entryTitle(e, omit = '') {
  const pick = [e.doctor, e.place, e.issue, e.type].find((c) => c && !sameType(c, omit));
  return pick || 'No doctor recorded yet';
}

// Whatever identifies the row next, minus the bit already used as the title and
// the bit already used as the group heading.
export function entrySubtitle(e, omit = '') {
  const title = entryTitle(e, omit);
  return [e.place, e.type]
    .filter((v) => v && v !== title && !sameType(v, omit))
    .join(' · ');
}

/* What the Issue column carries.

   Blank when the issue is already what the row is called — rows with nothing
   but an issue are common in this list, and printing "Neck sprain" in the name
   column and again in the issue column beside it is pure noise. */
export function issueCell(entry, omit = '') {
  return entry.issue && entry.issue !== entryTitle(entry, omit) ? entry.issue : '';
}

/* Free-text search across everything, because the thing you remember about a
   doctor is rarely their name — it's the street, the drug, or the complaint. */
export function matchesQuery(entry, query, fields = []) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [
    ...FIELD_KEYS.map((k) => entry[k]),
    statusLabel(entry.status),
    ...fields.map((f) => formatCustomValue(f, entry.custom?.[f.id])),
  ].join(' ').toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

/* The visible list, grouped under the type headings in the owner's order.

   Untyped rows come last under their own heading, and a group with nothing in
   it doesn't render at all rather than leaving a bare heading behind. */
export function groupByType(list, { query = '', status = 'all' } = {}) {
  const { types, fields, entries } = normalizeList(list);
  const visible = entries.filter((e) =>
    (status === 'all' || e.status === status) && matchesQuery(e, query, fields));

  const groups = types.map((type) => ({
    type,
    entries: visible
      .filter((e) => sameType(e.type, type))
      .sort((a, b) => entryTitle(a, type).localeCompare(entryTitle(b, type), undefined, { sensitivity: 'base' })),
  }));

  groups.push({
    type: NO_TYPE,
    entries: visible
      .filter((e) => !e.type)
      .sort((a, b) => entryTitle(a).localeCompare(entryTitle(b), undefined, { sensitivity: 'base' })),
  });

  return groups.filter((g) => g.entries.length > 0);
}

export function countByStatus(entries) {
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]));
  entries.forEach((e) => { if (counts[e.status] != null) counts[e.status] += 1; });
  return counts;
}

// How many records a type is carrying — shown beside it in the type editor, and
// used to warn before deleting a type that is in use.
export const typeUsage = (entries, type) => entries.filter((e) => sameType(e.type, type)).length;

// --- editing the records ---------------------------------------------------
//
// The table edits a cell at a time, so a change arrives as a patch of one or
// two fields rather than a whole record. Each of these takes the document and
// hands back a new one, and runs the result through normalizeList — which is
// what registers a type the moment a record starts using it, so typing a new
// speciality into a row makes its heading appear without a second step.

export function addEntry(list, entry = {}) {
  const l = normalizeList(list);
  return normalizeList({ ...l, entries: [...l.entries, normalizeEntry({ ...entry, id: entry.id || makeId() })] });
}

// The id is fixed: a patch can carry one in from a stale render without
// silently turning an edit into a second record.
export function updateEntry(list, id, patch) {
  const l = normalizeList(list);
  return normalizeList({
    ...l,
    entries: l.entries.map((e) => (e.id === id ? normalizeEntry({ ...e, ...patch, id: e.id }) : e)),
  });
}

export function removeEntry(list, id) {
  const l = normalizeList(list);
  return normalizeList({ ...l, entries: l.entries.filter((e) => e.id !== id) });
}

// A row that was added and never filled in. Offered so the page can clear one
// away rather than leaving a line of dashes behind.
export const isBlank = (entry) => !hasContent(entry);

// --- editing the type list -------------------------------------------------
//
// All of these take the whole document and hand back a new one, so a rename
// that has to touch both the list and the records can't half-apply.

export function addType(list, name) {
  const l = normalizeList(list);
  const clean = String(name ?? '').trim();
  if (!clean || l.types.some((t) => sameType(t, clean))) return l;
  return { ...l, types: [...l.types, clean] };
}

/* Rename a type, carrying every record using it.

   Renaming onto a name that already exists merges the two, which is the only
   sensible reading of it — the alternative is two headings spelled the same. */
export function renameType(list, from, to) {
  const l = normalizeList(list);
  const clean = String(to ?? '').trim();
  if (!clean || !l.types.some((t) => sameType(t, from))) return l;

  const collides = l.types.some((t) => sameType(t, clean) && !sameType(t, from));
  const types = collides
    ? l.types.filter((t) => !sameType(t, from))
    : l.types.map((t) => (sameType(t, from) ? clean : t));

  return {
    types,
    entries: l.entries.map((e) => (sameType(e.type, from) ? { ...e, type: clean } : e)),
  };
}

/* Drop a type. The records keep existing and fall into "No type" — deleting a
   heading must never quietly delete somebody's medical history with it. */
export function removeType(list, name) {
  const l = normalizeList(list);
  return {
    types: l.types.filter((t) => !sameType(t, name)),
    entries: l.entries.map((e) => (sameType(e.type, name) ? { ...e, type: NO_TYPE } : e)),
  };
}

// Move a type up or down the running order. Off either end is a no-op, so the
// buttons can stay live without the caller bounds-checking.
export function moveType(list, name, delta) {
  const l = normalizeList(list);
  const from = l.types.findIndex((t) => sameType(t, name));
  const to = from + delta;
  if (from < 0 || to < 0 || to >= l.types.length) return l;
  const types = [...l.types];
  const [moved] = types.splice(from, 1);
  types.splice(to, 0, moved);
  return { ...l, types };
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

// --- columns of your own ---------------------------------------------------
//
// The thirteen built-in fields are what the original spreadsheet had. Anything
// else — a referral source, a copay, whether they take your insurance — is a
// column you add here.
//
// This reuses lib/customFields.js, the same definitions-and-values machinery
// the Friends list runs on: an ordered array of definitions beside the records,
// and values on each record under `custom`, keyed by the field's generated id
// rather than its label, so renaming a column keeps every value attached to it.

export function addField(list, def = {}) {
  const l = normalizeList(list);
  const label = String(def.label ?? '').trim();
  if (!label) return l;
  const fields = normalizeFieldDefs([...l.fields, { ...def, id: def.id || newFieldId(), label }]);
  return { ...l, fields };
}

export function updateField(list, id, patch) {
  const l = normalizeList(list);
  const fields = normalizeFieldDefs(l.fields.map((f) => (f.id === id ? { ...f, ...patch, id: f.id } : f)));
  // A label edited down to nothing would be dropped by normalizeFieldDefs and
  // take the column with it, so an empty rename is refused instead.
  if (fields.length !== l.fields.length) return l;
  return { ...l, fields };
}

/* Delete a column, and the values under it.

   Unlike the Friends list, which keeps orphaned answers on the grounds that a
   hidden field may come back, a deleted column here is gone: its id is never
   reissued, so anything left behind would be data no screen can ever show
   again. The page warns how many records are carrying a value first. */
export function removeField(list, id) {
  const l = normalizeList(list);
  return {
    ...l,
    fields: l.fields.filter((f) => f.id !== id),
    entries: l.entries.map((e) => {
      if (!(id in (e.custom || {}))) return e;
      const custom = { ...e.custom };
      delete custom[id];
      return { ...e, custom };
    }),
  };
}

export function moveField(list, id, delta) {
  const l = normalizeList(list);
  const from = l.fields.findIndex((f) => f.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= l.fields.length) return l;
  const fields = [...l.fields];
  const [moved] = fields.splice(from, 1);
  fields.splice(to, 0, moved);
  return { ...l, fields };
}

// How many records are carrying a value for a column — what the delete warning
// counts, and what the column manager shows beside each one.
export const fieldUsage = (entries, id) =>
  entries.filter((e) => {
    const v = e.custom?.[id];
    return v !== undefined && v !== null && v !== '' && v !== false;
  }).length;

/* Write one custom value, coerced by its own definition.

   Coercing here rather than at the input means a number column stores a number
   whatever the cell was typed into, and a date column stores an ISO date, so
   sorting and the search index don't have to guess later. */
export function setCustomValue(list, entryId, fieldId, raw) {
  const l = normalizeList(list);
  const field = l.fields.find((f) => f.id === fieldId);
  if (!field) return l;
  const value = coerceCustomValue(field, raw);
  return normalizeList({
    ...l,
    entries: l.entries.map((e) => (e.id === entryId ? { ...e, custom: { ...e.custom, [fieldId]: value } } : e)),
  });
}

export const customValueOf = (entry, field) => entry?.custom?.[field?.id];

// What a custom column reads as, for display and for search.
export const customText = (entry, field) => formatCustomValue(field, customValueOf(entry, field));

/* The list as first recorded, used only when the account has none saved yet.

   Transcribed from the original spreadsheet. Two repairs were made to the text
   and nothing else: the dental address had lost the separators between its
   street, city and state, and rows carrying only a status keep their issue in
   the issue column. Medication spellings are left exactly as they were written
   — silently "correcting" a drug name in someone's medical notes is not this
   file's business. */
export function seedDoctors() {
  // The speciality column in the order it was given, which is the order the
  // headings run in until they're rearranged.
  const types = ['Gastroenterologist', 'Skin', 'Colorectal', 'Primary Physician', 'Dentist', 'Ear'];
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
  return normalizeList({ types, entries: rows.map((r, i) => ({ ...r, id: `seed-${i + 1}` })) });
}
