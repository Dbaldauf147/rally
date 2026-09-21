/* Treatments on the Doctors page: a course of something with a beginning and
 * an end, laid out across the months it covers.
 *
 * A record answers "who did I see for this?"; a treatment answers "what am I
 * on, and until when?" — the six weeks of physio, the two years of Invisalign,
 * the statin with no end in sight. Written down as a note it tells you nothing
 * about November; on a row of months you can see what overlaps what, and which
 * side of the finish line you are on.
 *
 * Months, not days. The question a course of treatment answers is "which
 * months am I in this?", and a start of "the 14th" is precision the answer
 * cannot use. So the ends are month keys — `YYYY-MM` — and an empty end means
 * it is still going.
 */

const pad2 = (n) => String(n).padStart(2, '0');

export const monthKey = (year, monthIndex) => `${year}-${pad2(monthIndex + 1)}`;

/** `YYYY-MM` → { year, month } (month 0-11), or null for anything else. */
export function parseMonth(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  if (month < 0 || month > 11) return null;
  return { year, month };
}

// Month keys sort as strings, which is the whole reason for the format.
const isMonth = (key) => !!parseMonth(key);

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const thisMonthKey = (today = new Date()) => monthKey(today.getFullYear(), today.getMonth());

let seq = 0;
const makeId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

/* One treatment, repaired.
 *
 * A range typed backwards is swapped rather than dropped: "Mar 2027 to Jan
 * 2027" is a fat-fingered pair of dropdowns, and the honest reading of it is
 * the months between them. A start that isn't a month at all leaves the
 * treatment unplaced — it still lists, it just has no bar to draw.
 */
export function normalizeTreatment(raw) {
  const str = (v) => String(v ?? '').trim();
  let start = isMonth(raw?.start) ? str(raw.start) : '';
  let end = isMonth(raw?.end) ? str(raw.end) : '';
  if (start && end && end < start) [start, end] = [end, start];
  return {
    id: str(raw?.id) || makeId(),
    name: str(raw?.name),
    type: str(raw?.type),
    doctor: str(raw?.doctor),
    start,
    end,
    notes: str(raw?.notes),
  };
}

// Soonest first, and within a month the one that ends first — a short course
// reads as a short course when it sits above an open-ended one.
const byWhen = (a, b) => (a.start || '9999').localeCompare(b.start || '9999')
  || (a.end || '9999-99').localeCompare(b.end || '9999-99')
  || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export function normalizeTreatments(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map(normalizeTreatment)
    .filter((t) => t.name || t.start)
    .sort(byWhen);
}

/** Whether a treatment is running in the given month key. */
export function coversMonth(treatment, key) {
  const t = normalizeTreatment(treatment);
  if (!t.start || !isMonth(key)) return false;
  if (key < t.start) return false;
  return !t.end || key <= t.end;
}

export const isOngoing = (t) => !!t?.start && !t?.end;

/* The years the grid draws.
 *
 * Everything the treatments touch, and this year whatever they touch, so the
 * page always has a column for the month you are standing in. An open-ended
 * course runs to the end of the range rather than off the edge of it, so the
 * last year shown is the latest of: this year, the latest end, and the latest
 * start (a course starting next spring is worth seeing before it begins).
 */
export function gridYears(treatments, today = new Date()) {
  const now = today.getFullYear();
  const years = [];
  for (const raw of treatments || []) {
    const t = normalizeTreatment(raw);
    const s = parseMonth(t.start);
    const e = parseMonth(t.end);
    if (s) years.push(s.year);
    if (e) years.push(e.year);
  }
  const from = Math.min(now, ...years);
  const to = Math.max(now, ...years);
  const out = [];
  for (let y = from; y <= to; y++) out.push(y);
  return out;
}

/* How a treatment reads in words: "Mar 2027 – Jun 2027", "From Mar 2027". */
export function describeSpan(treatment) {
  const t = normalizeTreatment(treatment);
  const label = (key) => {
    const p = parseMonth(key);
    return p ? `${MONTHS_SHORT[p.month]} ${p.year}` : '';
  };
  if (!t.start) return 'No dates yet';
  if (!t.end) return `From ${label(t.start)}`;
  if (t.start === t.end) return label(t.start);
  return `${label(t.start)} – ${label(t.end)}`;
}

/* Where a treatment sits against today: done, running, or still to come.
 * What the row's colour says before you count columns. */
export function treatmentState(treatment, today = new Date()) {
  const t = normalizeTreatment(treatment);
  const now = thisMonthKey(today);
  if (!t.start) return 'unplaced';
  if (t.start > now) return 'upcoming';
  if (!t.end || t.end >= now) return 'current';
  return 'past';
}

// --- editing ---------------------------------------------------------------
// The same shape as the rest of this page's editors: take the document, hand
// back a new one, and let the caller write it.

export function addTreatment(list, treatment) {
  const t = normalizeTreatment({ ...treatment, id: treatment?.id || makeId() });
  return { ...list, treatments: normalizeTreatments([...(list?.treatments || []), t]) };
}

export function updateTreatment(list, id, patch) {
  return {
    ...list,
    treatments: normalizeTreatments((list?.treatments || [])
      .map((t) => (t.id === id ? { ...t, ...patch, id } : t))),
  };
}

export function removeTreatment(list, id) {
  return { ...list, treatments: (list?.treatments || []).filter((t) => t.id !== id) };
}
