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

import { parseLooseDate, validParts, pad2 } from './looseDate';

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

// --- how long since the last visit ------------------------------------------
//
// The date itself is a column of the owner's own — a Date column added through
// the column manager — so nothing here stores one. This only reads whatever
// that column holds and counts.

/* Whole days between the date and today, or null when there is no date.

   Both ends are pinned to UTC midnight before subtracting, so the count is a
   number of calendar days and can't slip by one when the clocks change between
   the visit and today. parseLooseDate reads the ISO date a Date column stores,
   and also whatever a value written before the column had a type looks like. */
export function daysSince(value, today = new Date()) {
  const p = parseLooseDate(value);
  if (!validParts(p) || !p.year) return null;
  const then = Date.UTC(p.year, p.month - 1, p.day);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((now - then) / 86400000);
}

/* What the counter column prints.

   A bare number, because a column of bare numbers is what lets two rows be
   compared at a glance. "Today" reads better than a 0, and a date still in the
   future — an appointment typed in early — counts forward rather than printing
   a negative nobody reads as a date ahead. */
export function daysSinceLabel(value, today = new Date()) {
  const days = daysSince(value, today);
  if (days === null) return '';
  if (days === 0) return 'Today';
  if (days < 0) return `in ${-days}`;
  return String(days);
}

// --- when they're next due --------------------------------------------------
//
// The other half of the counter: the last visit says how long it has been, the
// cadence says how often it should be, and together they say when to book. Both
// are already on the record — the date in the Date column the counter reads,
// the cadence as the text it was written in — so nothing new is stored.
//
// This is the shape ReachOut already uses (last reach-out + cadence = next
// one), except the cadence here is prose rather than a number of days, because
// a doctor's is "Every 6 months" and nobody thinks of it as 182.

/* How often, read off the text as written.

   Returns whole months or whole days, never one converted to the other: six
   months after the 31st of January is the last day of February, which no
   number of days gets right.

   Null when the text says nothing countable — "as needed", a blank, a "-".
   The column then stays empty, which is the honest answer.

   Deliberately absent: "biannual" and "biennial". They differ by one letter
   and mean six months and two years, and are so widely swapped that neither
   reading can be trusted. A blank cell says "you'll have to look"; a date
   eighteen months wrong on a medical follow-up does not. */
const CADENCE_WORDS = {
  daily: { days: 1 },
  weekly: { days: 7 },
  fortnightly: { days: 14 },
  monthly: { months: 1 },
  bimonthly: { months: 2 },
  quarterly: { months: 3 },
  semiannual: { months: 6 },
  semiannually: { months: 6 },
  annual: { months: 12 },
  annually: { months: 12 },
  yearly: { months: 12 },
};

const UNIT_MONTHS = { month: 1, year: 12 };
const UNIT_DAYS = { day: 1, week: 7 };

export function parseCadence(text) {
  const s = String(text ?? '').trim().toLowerCase();
  if (!s) return null;

  // "every other year", the one English way of saying two without a number.
  let m = /\bevery\s+other\s+(day|week|month|year)\b/.exec(s);
  if (m) {
    const u = m[1];
    return UNIT_MONTHS[u] ? { months: UNIT_MONTHS[u] * 2 } : { days: UNIT_DAYS[u] * 2 };
  }

  /* "Every 6 months", "2 year(s)", "every 90 days". The "(s)" is the
     spreadsheet's, which wrote every cadence that way and would otherwise take
     the whole column with it. A bare "every month" counts as one. */
  m = /(?:\bevery\s+)?(\d+)?\s*(day|week|month|year)(?:s|\(s\))?\b/.exec(s);
  if (m) {
    const n = m[1] ? Number(m[1]) : (/\bevery\b/.test(s) ? 1 : 0);
    if (n > 0) {
      const u = m[2];
      return UNIT_MONTHS[u] ? { months: UNIT_MONTHS[u] * n } : { days: UNIT_DAYS[u] * n };
    }
  }

  for (const [word, every] of Object.entries(CADENCE_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(s)) return { ...every };
  }
  return null;
}

/* Add whole months to a date, clamped to the end of the month it lands in.

   31 January plus one month is 28 February, not 3 March. Rolling over would
   drift the appointment further every time it was counted forward. */
function addMonths({ year, month, day }, n) {
  const total = year * 12 + (month - 1) + n;
  const y = Math.floor(total / 12);
  const mo = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { year: y, month: mo, day: Math.min(day, lastDay) };
}

/* When they're next due, from a last-visit date and a cadence.

   Null unless both are there and both are readable — a visit with no cadence
   recorded is not overdue, it is unscheduled, and guessing one would put a
   date on every row in the list.

   `daysAway` counts calendar days from today, negative once it's past, so the
   column can mark the ones that have come and gone. Both ends are pinned to
   UTC midnight before subtracting, the same as daysSince, so the count can't
   slip by one when the clocks change in between. */
export function nextVisit(lastValue, cadence, today = new Date()) {
  const p = parseLooseDate(lastValue);
  if (!validParts(p) || !p.year) return null;
  const every = parseCadence(cadence);
  if (!every) return null;

  const due = every.months
    ? addMonths(p, every.months)
    : (() => {
      const t = new Date(Date.UTC(p.year, p.month - 1, p.day) + every.days * 86400000);
      return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
    })();

  const then = Date.UTC(due.year, due.month - 1, due.day);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const daysAway = Math.round((then - now) / 86400000);

  return {
    iso: `${due.year}-${pad2(due.month)}-${pad2(due.day)}`,
    // The same M/D/YYYY a Date column prints, so the two read as one row.
    label: `${due.month}/${due.day}/${due.year}`,
    daysAway,
    overdue: daysAway < 0,
    due: daysAway === 0,
  };
}

/* One record, with every field present as a string.

   Missing beats absent here: the form binds an input per field, and a record
   whose `notes` is undefined would make that input uncontrolled and warn. */
export function normalizeEntry(raw) {
  const out = { id: String(raw?.id || makeId()) };
  FIELD_KEYS.forEach((k) => { out[k] = String(raw?.[k] ?? '').trim(); });
  out.status = parseStatus(raw?.status);
  // Appointments off the calendar this record has been matched to. See the
  // appointments section below for why they're stored rather than re-fetched.
  out.appointments = normalizeAppointments(raw?.appointments);
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
/* ── Questions ───────────────────────────────────────────────────────
   The things you mean to ask and forget in the room.

   A question belongs to a record, carries whatever tags you file it under,
   and is either still to ask or answered — with room for what they said,
   because the answer is the whole point of having written the question down.

   `entryId` is allowed to be empty: "ask whoever I see next about the mole"
   is a real thing to want to write down before you know who that is. */
export function normalizeQuestion(raw) {
  const tags = Array.isArray(raw?.tags) ? raw.tags : [];
  return {
    id: String(raw?.id ?? '').trim() || makeId(),
    entryId: String(raw?.entryId ?? '').trim(),
    text: String(raw?.text ?? '').trim(),
    tags: dedupeTypes(tags),
    answer: String(raw?.answer ?? '').trim(),
    answered: !!raw?.answered,
    // Written down when, so the list can run newest-first without the owner
    // ordering it by hand.
    created: String(raw?.created ?? '').trim() || todayKey(new Date()),
  };
}

export function normalizeList(raw) {
  const rawEntries = Array.isArray(raw?.entries) ? raw.entries : Array.isArray(raw) ? raw : [];
  const entries = rawEntries.map(normalizeEntry);
  const questions = (Array.isArray(raw?.questions) ? raw.questions : []).map(normalizeQuestion)
    .filter((q) => q.text);
  const declared = Array.isArray(raw?.types) ? raw.types : [];
  const used = entries.map((e) => e.type).filter(Boolean);
  // Column order, renames and hidden-ness are stored by key alone; see
  // resolveColumns, which is what turns them back into columns.
  const strings = (v) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x ?? '').trim()).filter(Boolean))] : []);
  const labels = {};
  if (raw?.columnLabels && typeof raw.columnLabels === 'object') {
    Object.entries(raw.columnLabels).forEach(([k, v]) => {
      const label = String(v ?? '').trim();
      if (k && label) labels[k] = label;
    });
  }
  return {
    types: dedupeTypes([...declared, ...used]),
    fields: normalizeFieldDefs(raw?.fields),
    columnOrder: strings(raw?.columnOrder),
    columnLabels: labels,
    hiddenColumns: strings(raw?.hiddenColumns),
    daysSinceSource: String(raw?.daysSinceSource ?? '').trim(),
    calendar: {
      id: String(raw?.calendar?.id ?? '').trim(),
      name: String(raw?.calendar?.name ?? '').trim(),
    },
    // Events told "this isn't a doctor's appointment". Kept by id so they stop
    // being offered without being linked to anything.
    ignoredEvents: strings(raw?.ignoredEvents),
    questions,
    // Declared tags and used tags together, so a tag survives being taken off
    // the last question wearing it — the same bargain the speciality list makes.
    questionTags: dedupeTypes([...strings(raw?.questionTags), ...questions.flatMap((q) => q.tags)]),
    entries,
  };
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
export const NO_DOCTOR = 'No doctor recorded yet';

export function entryTitle(e, omit = '') {
  const pick = [e.doctor, e.place, e.issue, e.type].find((c) => c && !sameType(c, omit));
  return pick || NO_DOCTOR;
}

/* What a record is called when you're picking one from a list.

   The speciality leads here, because filing "Cleaning — 9:00" you think "that's
   the dentist", not the name of the practice. Whatever identifies the record
   follows it, so two records under one speciality stay tellable apart — a
   list of "Skin", "Skin" would be no use to pick from.

   A record with no speciality falls back to that identifier alone, and one with
   nothing but a speciality shows it alone rather than trailing an apology. */
export function entryPickerLabel(e) {
  const type = String(e?.type || '').trim();
  if (!type) return entryTitle(e);
  const rest = entryTitle(e, type);
  return rest === NO_DOCTOR ? type : `${type} — ${rest}`;
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

/* ── Check-ins and issues ────────────────────────────────────────────
   Two things live in this list, answering different questions. "Who am I due
   to see?" is about a schedule — the dentist every six months, the annual
   physical. "What is wrong with me, or was?" is about a complaint — the neck
   sprain, the plantar fasciitis.

   A record can be both, and the dentist usually is: seen twice a year, and
   also where the angular cheilitis got sorted out. So the two lanes are NOT
   exclusive. A record with a cadence and an issue shows under both, because it
   genuinely is both, and dropping it from one of them would be wrong whichever
   one you picked.

   A record with neither — a specialist whose number you keep and nothing
   currently wrong — sits under check-ins, so nothing falls out of the list. */
export const LANES = [
  { key: 'checkins', label: 'Check-ins' },
  { key: 'issues', label: 'Issues' },
  // Not a slice of the records like the other two — it's the questions you
  // mean to ask them. It sits here because it's the same question as the tabs
  // beside it ("what about this doctor?"), asked from the other side.
  { key: 'questions', label: 'Questions' },
];

// A complaint: something written in the issue field, or a status that only
// means anything when there is one.
export const isIssueEntry = (e) => !!String(e?.issue || '').trim()
  || e?.status === STATUS.TREATING || e?.status === STATUS.RESOLVED;

// Somebody you see on a schedule. Any cadence text counts, not only one that
// parses: "when it flares up" is still you saying this is an ongoing
// arrangement, even though no date can be worked out from it.
export const isCheckInEntry = (e) => !!String(e?.cadence || '').trim() || !isIssueEntry(e);

export function inLane(entry, lane) {
  if (lane === 'issues') return isIssueEntry(entry);
  if (lane === 'checkins') return isCheckInEntry(entry);
  return true;
}

// For the numbers on the tabs. They add up to more than the list when a record
// is in both, which is the honest total for a tab that says what it holds.
export function laneCounts(list) {
  const { entries, questions } = normalizeList(list);
  return {
    all: entries.length,
    checkins: entries.filter(isCheckInEntry).length,
    issues: entries.filter(isIssueEntry).length,
    // Only the ones still to ask. A tab reading "Questions 34" when 30 of them
    // were answered years ago is a number you learn to ignore.
    questions: questions.filter((q) => !q.answered).length,
  };
}

/* The visible list, grouped under the type headings in the owner's order.

   Untyped rows come last under their own heading, and a group with nothing in
   it doesn't render at all rather than leaving a bare heading behind. */
/* Something settled sinks.

   Being treated first, then ongoing, then resolved — the order the filter pills
   already run in. It applies inside a heading and to the headings themselves:
   a speciality with nothing left open drops below one that still has something
   going on, keeping its place relative to the other settled ones.

   Without the second half the page reads backwards. Four specialities whose
   only record is a resolved complaint sat above the one thing actually being
   treated, because they happened to come first in the type order — and the type
   order is about how you like the list arranged, not about what still needs
   attention. */
const statusRank = (e) => {
  const i = STATUS_ORDER.indexOf(e?.status);
  return i === -1 ? STATUS_ORDER.indexOf(STATUS.NONE) : i;
};
const settled = (group) => group.entries.every((e) => e.status === STATUS.RESOLVED);

export function groupByType(list, { query = '', status = 'all', lane = 'all' } = {}) {
  const { types, fields, entries } = normalizeList(list);
  const visible = entries.filter((e) =>
    (status === 'all' || e.status === status) && inLane(e, lane) && matchesQuery(e, query, fields));

  const byStatusThenName = (type) => (a, b) =>
    statusRank(a) - statusRank(b)
    || entryTitle(a, type).localeCompare(entryTitle(b, type), undefined, { sensitivity: 'base' });

  const groups = types.map((type) => ({
    type,
    entries: visible.filter((e) => sameType(e.type, type)).sort(byStatusThenName(type)),
  }));

  groups.push({
    type: NO_TYPE,
    entries: visible.filter((e) => !e.type).sort(byStatusThenName(NO_TYPE)),
  });

  // Stable within each half, so the owner's type order still decides everything
  // except whether a heading has anything left open.
  const shown = groups.filter((g) => g.entries.length > 0);
  return [...shown.filter((g) => !settled(g)), ...shown.filter(settled)];
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

  // Spread the list: a rename changes the types and the records carrying them
  // and nothing else. Rebuilding the object from those two alone dropped the
  // added columns, their order and labels, what the counter counts from, and
  // the linked calendar — every one of them silently, on a rename.
  return {
    ...l,
    types,
    entries: l.entries.map((e) => (sameType(e.type, from) ? { ...e, type: clean } : e)),
  };
}

/* Drop a type. The records keep existing and fall into "No type" — deleting a
   heading must never quietly delete somebody's medical history with it. */
export function removeType(list, name) {
  const l = normalizeList(list);
  return {
    ...l, // as in renameType: everything else on the list survives a delete
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

// --- questions -------------------------------------------------------------
//
// Every one of these takes the list and gives back a new one, like the record
// and column helpers above, so the page never edits what it was handed.

// Write one down. A blank question is refused rather than stored empty: the
// add box can stay live without the caller checking first.
export function addQuestion(list, { text, entryId = '', tags = [] } = {}) {
  const l = normalizeList(list);
  const q = normalizeQuestion({ text, entryId, tags });
  if (!q.text) return l;
  // Newest first, which is where you'll look for the one you just typed.
  return { ...l, questions: [q, ...l.questions] };
}

export function updateQuestion(list, id, patch) {
  const l = normalizeList(list);
  return {
    ...l,
    questions: l.questions.map((q) => (q.id === id ? normalizeQuestion({ ...q, ...patch, id: q.id }) : q)),
  };
}

export function removeQuestion(list, id) {
  const l = normalizeList(list);
  return { ...l, questions: l.questions.filter((q) => q.id !== id) };
}

/* Put a tag on a question or take it off.

   The tag joins the list's vocabulary on the way in, so it can be offered on
   the next question without being typed again — and it stays there when the
   last question wearing it loses it, because a tag you've used once is a tag
   you meant. */
export function toggleQuestionTag(list, id, tag) {
  const l = normalizeList(list);
  const clean = String(tag ?? '').trim();
  if (!clean) return l;
  const questions = l.questions.map((q) => {
    if (q.id !== id) return q;
    const on = q.tags.some((t) => sameType(t, clean));
    return { ...q, tags: on ? q.tags.filter((t) => !sameType(t, clean)) : [...q.tags, clean] };
  });
  return { ...l, questionTags: dedupeTypes([...l.questionTags, clean]), questions };
}

// Add a tag to the vocabulary without putting it on anything yet.
export function addQuestionTag(list, tag) {
  const l = normalizeList(list);
  const clean = String(tag ?? '').trim();
  if (!clean || l.questionTags.some((t) => sameType(t, clean))) return l;
  return { ...l, questionTags: [...l.questionTags, clean] };
}

/* Retire a tag: off the vocabulary and off every question wearing it.

   Unlike deleting a speciality, which leaves the records behind under "No
   type", there is nothing to leave behind here — the question keeps its text
   and its record and simply stops being filed under this word. */
export function removeQuestionTag(list, tag) {
  const l = normalizeList(list);
  return {
    ...l,
    questionTags: l.questionTags.filter((t) => !sameType(t, tag)),
    questions: l.questions.map((q) => ({ ...q, tags: q.tags.filter((t) => !sameType(t, tag)) })),
  };
}

// Does this question match what's typed in the box? Its text, its answer and
// its tags all count — you might remember any of the three.
export function questionMatches(q, query) {
  const term = String(query || '').trim().toLowerCase();
  if (!term) return true;
  const hay = [q.text, q.answer, ...q.tags].join(' ').toLowerCase();
  return term.split(/\s+/).every((w) => hay.includes(w));
}

/* The questions, under the record each one is for.

   Grouped by record rather than listed flat because that's how they get used:
   you're about to see the dentist and you want the dentist's four, not a
   chronological feed. Records run in the order the table has them, so the two
   views agree; anything not assigned to a record yet comes last under its own
   heading, and a record with nothing to ask doesn't appear at all.

   Answered questions sink within a group but stay put — what they said is
   often the thing you came back for. */
export function groupQuestions(list, { query = '', tag = 'all', answered = 'open' } = {}) {
  const l = normalizeList(list);
  const wanted = l.questions.filter((q) => (
    questionMatches(q, query)
    && (tag === 'all' || q.tags.some((t) => sameType(t, tag)))
    && (answered === 'all' || (answered === 'answered' ? q.answered : !q.answered))
  ));
  const sorted = [...wanted].sort((a, b) => (
    (a.answered === b.answered ? 0 : a.answered ? 1 : -1)
    || b.created.localeCompare(a.created)
  ));

  const groups = [];
  const byEntry = new Map();
  l.entries.forEach((e) => {
    const g = { entryId: e.id, entry: e, questions: [] };
    byEntry.set(e.id, g);
    groups.push(g);
  });
  const loose = { entryId: '', entry: null, questions: [] };
  sorted.forEach((q) => (byEntry.get(q.entryId) || loose).questions.push(q));
  return [...groups, loose].filter((g) => g.questions.length > 0);
}

// How many questions wear each tag, for the numbers on the filter pills. Only
// the open ones, to agree with the count on the tab.
export function questionTagCounts(list) {
  const l = normalizeList(list);
  const counts = Object.fromEntries(l.questionTags.map((t) => [t, 0]));
  l.questions.forEach((q) => {
    if (q.answered) return;
    q.tags.forEach((t) => {
      const key = l.questionTags.find((x) => sameType(x, t));
      if (key) counts[key] += 1;
    });
  });
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

// --- appointments off a Google Calendar -------------------------------------
//
// The owner nominates one calendar — a "Medical" one, typically — and every
// appointment on it is either linked to the record it belongs to or waved off.
// Linking is what makes an appointment count for anything: a past one writes
// the visit into the Date column the counter reads, and a booked future one
// answers "next visit" outright instead of leaving the cadence to guess it.
//
// What's linked is stored on the record rather than held in the fetch. The page
// has to read the same offline, and a calendar that stops being reachable —
// revoked, renamed, deleted — must not blank the dates it already contributed.
// The fetch only ever tells us about events we haven't decided about yet.

/* An appointment's day, from either shape Google returns: an all-day event
   carries "2026-03-12", a timed one "2026-03-12T14:00:00-04:00". Only the day
   matters here, and taking it off the front of the string keeps it the day the
   calendar says rather than the day the reader's timezone shifts it to. */
const apptDay = (value) => {
  const p = parseLooseDate(String(value ?? '').slice(0, 10));
  return validParts(p) && p.year ? `${p.year}-${pad2(p.month)}-${pad2(p.day)}` : '';
};

const todayKey = (today) =>
  `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;

/* One record's linked appointments, oldest first.

   An event with no readable day is dropped: it can't be counted from, and
   keeping it would leave a row no column could show. */
export function normalizeAppointments(raw) {
  const seen = new Set();
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach((a) => {
    const eventId = String(a?.eventId ?? '').trim();
    const date = apptDay(a?.date ?? a?.start);
    if (!eventId || !date || seen.has(eventId)) return;
    seen.add(eventId);
    out.push({ eventId, date, title: String(a?.title ?? '').trim() });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* The visit already had, and the one still to come.

   Today's appointment counts as had. You were there this morning, and the
   counter saying "Today" is the right answer — calling it upcoming would put a
   booking in the future that has already happened. */
export function lastAppointment(entry, today = new Date()) {
  const t = todayKey(today);
  const past = (entry?.appointments || []).filter((a) => a.date <= t);
  return past.length ? past[past.length - 1] : null;
}

export function nextAppointment(entry, today = new Date()) {
  const t = todayKey(today);
  return (entry?.appointments || []).find((a) => a.date > t) || null;
}

/* What the Next visit column shows.

   A booked appointment beats the cadence's arithmetic — the cadence says when
   you're due, the calendar says when you're going, and the second is the one
   worth printing. `booked` marks which it is, so the column can say so. */
export function upcomingVisit(entry, lastValue, today = new Date()) {
  const booked = nextAppointment(entry, today);
  if (!booked) {
    const guess = nextVisit(lastValue, entry?.cadence, today);
    return guess ? { ...guess, booked: false, title: '' } : null;
  }
  const p = parseLooseDate(booked.date);
  const then = Date.UTC(p.year, p.month - 1, p.day);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const daysAway = Math.round((then - now) / 86400000);
  return {
    iso: booked.date,
    label: `${p.month}/${p.day}/${p.year}`,
    daysAway,
    overdue: false, // in the future by construction
    due: daysAway === 0,
    booked: true,
    title: booked.title,
  };
}

// Which calendar the appointments come from. Clearing it leaves everything
// already linked alone — those dates belong to the records now.
export function setDoctorCalendar(list, id, name) {
  const l = normalizeList(list);
  return { ...l, calendar: { id: String(id ?? '').trim(), name: String(name ?? '').trim() } };
}

// Every event id already spoken for, linked or waved off, so the suggestions
// can be whatever is left.
export function settledEventIds(list) {
  const l = normalizeList(list);
  const out = new Set(l.ignoredEvents);
  l.entries.forEach((e) => e.appointments.forEach((a) => out.add(a.eventId)));
  return out;
}

/* Link an appointment to a record.

   A past one also writes its day into the Date column the counter reads —
   that's the point of linking it — but only when it's later than what's there,
   so filing an old appointment can't walk the last-visit date backwards past a
   more recent one. */
export function linkAppointment(list, entryId, event, { dateFieldId = '', today = new Date() } = {}) {
  const l = normalizeList(list);
  const entry = l.entries.find((e) => e.id === entryId);
  const date = apptDay(event?.date ?? event?.start);
  const eventId = String(event?.eventId ?? event?.id ?? '').trim();
  if (!entry || !date || !eventId) return l;

  const appointment = { eventId, date, title: String(event?.title ?? '').trim() };
  const linked = normalizeList({
    ...l,
    // An event linked to one record and then to another moves rather than
    // ending up on both: it was one appointment either way.
    entries: l.entries.map((e) => ({
      ...e,
      appointments: e.id === entryId
        ? [...e.appointments.filter((a) => a.eventId !== eventId), appointment]
        : e.appointments.filter((a) => a.eventId !== eventId),
    })),
    ignoredEvents: l.ignoredEvents.filter((id) => id !== eventId),
  });

  if (!dateFieldId || date > todayKey(today)) return linked;
  const current = apptDay(linked.entries.find((e) => e.id === entryId)?.custom?.[dateFieldId]);
  if (current && current >= date) return linked;
  return setCustomValue(linked, entryId, dateFieldId, date);
}

/* Unlink one, and wave one off.

   Neither touches the Date column. A date written into a record belongs to the
   record now — it may have been edited since, and quietly rewinding a
   last-visit date is worse than leaving one that's a day too generous. */
export function unlinkAppointment(list, eventId) {
  const l = normalizeList(list);
  const id = String(eventId ?? '').trim();
  return normalizeList({
    ...l,
    entries: l.entries.map((e) => ({ ...e, appointments: e.appointments.filter((a) => a.eventId !== id) })),
  });
}

export function ignoreAppointment(list, eventId) {
  const l = normalizeList(list);
  const id = String(eventId ?? '').trim();
  if (!id) return l;
  return normalizeList({
    ...l,
    entries: l.entries.map((e) => ({ ...e, appointments: e.appointments.filter((a) => a.eventId !== id) })),
    ignoredEvents: [...l.ignoredEvents, id],
  });
}

// Put a waved-off event back among the suggestions.
export function unignoreAppointment(list, eventId) {
  const l = normalizeList(list);
  const id = String(eventId ?? '').trim();
  return { ...l, ignoredEvents: l.ignoredEvents.filter((x) => x !== id) };
}

/* Guessing which record an appointment belongs to.

   Calendar entries are written for the person reading them — "Dr Chen 2pm",
   "Dermatology follow-up", "Bloods at Newport Medical" — so the signal is
   whichever of a record's own words turn up in the event. A surname is worth
   more than a speciality, because a speciality is shared by every record under
   that heading.

   Words too short or too common to mean anything go first, so "Appointment"
   and "Dr" can't match every record in the list at once. */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'dr', 'drs', 'doctor', 'appointment', 'appt', 'visit',
  'follow', 'followup', 'check', 'checkup', 'annual', 'yearly', 'exam', 'consult',
  'consultation', 'office', 'clinic', 'center', 'centre', 'medical', 'health', 'new',
  'patient', 'review', 'call', 'phone', 'video', 'telehealth', 'test', 'tests',
]);

const words = (text) => String(text ?? '')
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

// Every word of the phrase present in the event — a two-word place name has to
// arrive whole rather than on the strength of one half.
const allPresent = (phrase, haystack) => {
  const parts = words(phrase);
  return parts.length > 0 && parts.every((w) => haystack.has(w));
};

const surnameOf = (name) => {
  const parts = words(name);
  return parts.length ? parts[parts.length - 1] : '';
};

/* The record an event most likely belongs to, or null when nothing in the list
   looks like it. `reason` is what matched, so the page can show its working
   rather than asking for a yes to an unexplained guess. */
export function suggestEntryFor(event, entries) {
  const haystack = new Set(words(`${event?.title ?? ''} ${event?.location ?? ''}`));
  if (haystack.size === 0) return null;

  let best = null;
  (entries || []).forEach((entry) => {
    let score = 0;
    let reason = '';
    if (allPresent(entry.doctor, haystack)) { score += 4; reason = 'name'; }
    else if (surnameOf(entry.doctor) && haystack.has(surnameOf(entry.doctor))) { score += 3; reason = 'name'; }
    if (allPresent(entry.place, haystack)) { score += 2; reason = reason || 'place'; }
    if (allPresent(entry.type, haystack)) { score += 1; reason = reason || 'type'; }
    if (score > (best?.score ?? 0)) best = { entryId: entry.id, score, reason };
  });
  // One weak signal on its own — a speciality half the list shares — isn't
  // worth putting a name to. Better to offer the event unmatched.
  return best && best.score >= 2 ? best : null;
}

/* The appointments still waiting on a decision, each with its guess.

   Latest first, which puts what's booked ahead of what's been and gone: the
   upcoming ones are the ones a decision actually changes. */
export function pendingAppointments(list, events) {
  const l = normalizeList(list);
  const settled = settledEventIds(l);
  const checkIns = l.entries.filter(isCheckInEntry);
  return (events || [])
    .map((e) => ({
      eventId: String(e?.id ?? e?.eventId ?? '').trim(),
      date: apptDay(e?.start ?? e?.date),
      title: String(e?.title ?? '').trim(),
      location: String(e?.location ?? '').trim(),
      allDay: !!e?.allDay,
    }))
    .filter((e) => e.eventId && e.date && !settled.has(e.eventId))
    .map((e) => ({ ...e, suggestion: suggestEntryFor(e, checkIns) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// --- the columns, built-in and added alike ---------------------------------
//
// The six built-in columns and the ones the owner adds are the same thing to
// the table, so they share one order, one set of labels and one hidden list.
// That's what lets an added column sit between two built-in ones instead of
// being stuck on the end.
//
// Order, labels and hidden-ness are stored by key and nothing else: the
// built-in columns are defined in code, an added one in `fields`. A key that
// belongs to neither — a column deleted since — is simply skipped when the
// order is resolved, so stale entries can't leave a gap.

export const BUILTIN_COLUMNS = [
  { key: 'name', label: 'Doctor' },
  { key: 'issue', label: 'Issue' },
  { key: 'meds', label: 'Meds' },
  { key: 'contact', label: 'Contact' },
  { key: 'cadence', label: 'Cadence' },
  // Computed, not stored: it counts from a Date column of the owner's own.
  { key: 'daysSince', label: 'Days since' },
  // Also computed, from that same date and the cadence beside it. It sits next
  // to the counter because they are the two halves of one question.
  { key: 'nextVisit', label: 'Next visit' },
  { key: 'status', label: 'Status' },
];

const BUILTIN_LABEL = Object.fromEntries(BUILTIN_COLUMNS.map((c) => [c.key, c.label]));
export const isBuiltinColumn = (key) => key in BUILTIN_LABEL;

/* Every column in display order, hidden ones included.

   Anything known but unplaced goes on the end, so adding a column needs no
   bookkeeping here and an order written before a column existed still works. */
export function resolveColumns(list) {
  const l = normalizeList(list);
  const known = [...BUILTIN_COLUMNS.map((c) => c.key), ...l.fields.map((f) => f.id)];
  const knownSet = new Set(known);
  const seen = new Set();
  const ordered = [];
  l.columnOrder.forEach((k) => {
    if (knownSet.has(k) && !seen.has(k)) { seen.add(k); ordered.push(k); }
  });
  known.forEach((k) => { if (!seen.has(k)) { seen.add(k); ordered.push(k); } });

  const hidden = new Set(l.hiddenColumns);
  return ordered.map((key) => {
    const field = l.fields.find((f) => f.id === key) || null;
    return {
      key,
      kind: field ? 'custom' : 'builtin',
      field,
      // An added column is named by its definition; a built-in one by its
      // override if it has been renamed, and by the default otherwise.
      label: field ? field.label : (l.columnLabels[key] || BUILTIN_LABEL[key]),
      hidden: hidden.has(key),
    };
  });
}

export const visibleColumns = (list) => resolveColumns(list).filter((c) => !c.hidden);

/* The Date columns the counter could count from, in display order. */
export const dateColumns = (list) =>
  resolveColumns(list).filter((c) => c.kind === 'custom' && c.field.type === 'date');

/* The one it actually counts from.

   The owner's choice when they have made one and it is still a Date column;
   otherwise the leftmost Date column, so a list with a single "Last Visit"
   column needs no choosing at all. Null when there is no Date column yet —
   the counter then has nothing to count and every cell in it is empty. */
export function daysSinceField(list) {
  const l = normalizeList(list);
  const dates = dateColumns(l);
  const chosen = dates.find((c) => c.key === l.daysSinceSource);
  return (chosen || dates[0])?.field || null;
}

// Point the counter at a different Date column. A key that isn't one is
// refused rather than stored and silently ignored later.
export function setDaysSinceSource(list, key) {
  const l = normalizeList(list);
  if (!dateColumns(l).some((c) => c.key === key)) return l;
  return { ...l, daysSinceSource: key };
}

/* Rename any column.

   An added column is named by its own definition, so that's where the new name
   goes; a built-in one keeps its name in an override map. Renaming a built-in
   back to what it started as drops the override rather than storing a value
   equal to the default. */
export function renameColumn(list, key, label) {
  const l = normalizeList(list);
  const clean = String(label ?? '').trim();
  if (!clean) return l;
  if (l.fields.some((f) => f.id === key)) return updateField(l, key, { label: clean });
  if (!isBuiltinColumn(key)) return l;
  const columnLabels = { ...l.columnLabels };
  if (clean === BUILTIN_LABEL[key]) delete columnLabels[key];
  else columnLabels[key] = clean;
  return { ...l, columnLabels };
}

/* Show or hide a column.

   Hiding is what "remove" means for a built-in column: the phone numbers and
   addresses are still on every record, and unhiding brings the column back
   with all of them. Deleting an added column is the destructive one, because
   its values have nowhere else to live — see removeField. */
export function setColumnHidden(list, key, hidden) {
  const l = normalizeList(list);
  const rest = l.hiddenColumns.filter((k) => k !== key);
  return { ...l, hiddenColumns: hidden ? [...rest, key] : rest };
}

// Move a column along the running order. Off either end is a no-op, so the
// buttons can stay live without the caller bounds-checking.
export function moveColumn(list, key, delta) {
  const l = normalizeList(list);
  const order = resolveColumns(l).map((c) => c.key);
  const from = order.indexOf(key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return l;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { ...l, columnOrder: next };
}

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
