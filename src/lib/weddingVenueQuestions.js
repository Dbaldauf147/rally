/* Wedding → Questions: what to ask while touring a venue, ticked off and
   answered venue by venue.

   Kept on the user doc as `weddingVenueQuestions`, beside `weddingVenues`:

     { custom:  [{ id, text, category }],          // your own questions, for every venue
       edits:   { [builtInId]: { text, category } }, // built-in questions you reworded or refiled
       answers: { [venueId]: { [questionId]: { done, notes } } } }

   Beside the venues rather than on them: the Venues tab saves its whole list
   on every edit (and normalizeVenue keeps only the fields it knows), so an
   answer stored on a venue would be written over from another tab or device.
   Here a tick is written as just its own leaf — see answerWrite. */

export const QUESTIONS_FIELD = 'weddingVenueQuestions';

// Where a question of your own goes when it isn't filed under a built-in category.
export const CUSTOM_CATEGORY = 'custom';
export const CUSTOM_CATEGORY_NAME = 'My questions';

// The ids are what answers are saved under: reword a question freely, but
// leave its id alone.
export const SEED_CATEGORIES = [
  {
    id: 'basics',
    name: 'Availability and basics',
    questions: [
      { id: 'basics-date', text: 'Is my date open, and how do prices vary by day or season?' },
      { id: 'basics-capacity', text: 'What’s the capacity, seated and standing?' },
      { id: 'basics-hours', text: 'How many hours do we get, and do they include setup and teardown?' },
      { id: 'basics-events-per-day', text: 'Do you host more than one event per day?' },
    ],
  },
  {
    id: 'cost',
    name: 'Cost',
    questions: [
      { id: 'cost-included', text: 'What exactly is included (tables, chairs, linens, staff, parking)?' },
      { id: 'cost-total', text: 'What’s the total with taxes, service charges and gratuity?' },
      { id: 'cost-minimum', text: 'Is there a food and beverage minimum?' },
      { id: 'cost-deposit', text: 'What’s the deposit, payment schedule and cancellation or reschedule policy?' },
      { id: 'cost-overtime', text: 'What are the overtime fees?' },
    ],
  },
  {
    id: 'food',
    name: 'Food and drink',
    questions: [
      { id: 'food-catering', text: 'Is catering in-house, or can we bring our own?' },
      { id: 'food-alcohol', text: 'Can we bring our own alcohol, and is there a corkage fee?' },
      { id: 'food-tasting', text: 'Are a tasting and a cake-cutting included in the price?' },
    ],
  },
  {
    id: 'vendors',
    name: 'Vendors and rules',
    questions: [
      { id: 'vendors-preferred', text: 'Do we have to use your preferred vendors?' },
      { id: 'vendors-decor', text: 'Are there decor restrictions (candles, hanging items, confetti)?' },
      { id: 'vendors-curfew', text: 'Is there a noise curfew or a music cutoff time?' },
      { id: 'vendors-insurance', text: 'Do vendors need their own insurance, and do we need event insurance?' },
    ],
  },
  {
    id: 'logistics',
    name: 'Logistics',
    questions: [
      { id: 'logistics-rain', text: 'What’s the rain plan for outdoor spaces?' },
      { id: 'logistics-getting-ready', text: 'Is there a getting-ready space for both sides?' },
      { id: 'logistics-parking', text: 'How do parking, accessibility and nearby lodging work?' },
      { id: 'logistics-point-person', text: 'Who is our point person on the day, and is a coordinator included?' },
      { id: 'logistics-access', text: 'When can we get in for the rehearsal and for drop-offs?' },
    ],
  },
  {
    id: 'gut',
    name: 'Gut check',
    questions: [
      { id: 'gut-photos', text: 'Can we see photos of a real wedding here at our guest count?' },
      { id: 'gut-wish-known', text: 'What do couples most often wish they’d known before booking?' },
    ],
  },
];

const MAX_QUESTION = 300;
const MAX_NOTES = 1000;
const CUSTOM_ID = /^q-[a-z0-9-]+$/;
const SEED_BY_ID = new Map(SEED_CATEGORIES.flatMap((c) => c.questions.map((q) => [q.id, { text: q.text, category: c.id }])));
const SEED_IDS = new Set(SEED_BY_ID.keys());
const CATEGORY_IDS = new Set([...SEED_CATEGORIES.map((c) => c.id), CUSTOM_CATEGORY]);

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const cleanText = (v) => str(v).replace(/\s+/g, ' ').slice(0, MAX_QUESTION);
const cleanNotes = (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, MAX_NOTES) : '');
const cleanCategory = (v) => (CATEGORY_IDS.has(v) ? v : CUSTOM_CATEGORY);
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export function newQuestionId() {
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const cleanAnswer = (a) => ({ done: a?.done === true, notes: cleanNotes(a?.notes) });
const isBlank = (a) => !a.done && !a.notes;

/* Whatever is saved (or nothing) → the shape above. A question with no text
   or a bad id is dropped; an answer that says nothing isn't kept. Answers to
   questions that no longer exist are kept as saved — they don't count toward
   anything (venueProgress only looks at the current questions). */
export function normalizeQuestionState(raw) {
  const custom = [];
  const seen = new Set();
  for (const q of Array.isArray(raw?.custom) ? raw.custom : []) {
    const id = str(q?.id);
    const text = cleanText(q?.text);
    if (!CUSTOM_ID.test(id) || SEED_IDS.has(id) || seen.has(id) || !text) continue;
    seen.add(id);
    custom.push({ id, text, category: cleanCategory(q?.category) });
  }
  const answers = {};
  for (const [venueId, byQuestion] of Object.entries(isObject(raw?.answers) ? raw.answers : {})) {
    if (!venueId || !isObject(byQuestion)) continue;
    const kept = {};
    for (const [qid, a] of Object.entries(byQuestion)) {
      if (!isObject(a)) continue;
      const clean = cleanAnswer(a);
      if (!isBlank(clean)) kept[qid] = clean;
    }
    if (Object.keys(kept).length) answers[venueId] = kept;
  }
  return { custom, edits: cleanEdits(raw?.edits), answers };
}

// The built-in questions that read differently from how they shipped. One
// put back to its original wording and category isn't an edit any more.
function cleanEdits(raw) {
  const edits = {};
  for (const [id, e] of Object.entries(isObject(raw) ? raw : {})) {
    const seed = SEED_BY_ID.get(id);
    if (!seed || !isObject(e)) continue;
    const text = cleanText(e.text) || seed.text;
    const category = CATEGORY_IDS.has(e.category) ? e.category : seed.category;
    if (text !== seed.text || category !== seed.category) edits[id] = { text, category };
  }
  return edits;
}

/* The questions as the page shows them: the built-in categories in order,
   each followed by the questions you filed under it, then "My questions"
   when there are any. A built-in question you edited shows your wording, in
   the category you put it in. Each question: { id, text, custom, edited }. */
export function questionGroups(state) {
  const custom = state?.custom || [];
  const edits = state?.edits || {};
  const seeds = SEED_CATEGORIES.flatMap((c) => c.questions.map((q) => {
    const e = edits[q.id];
    return { id: q.id, text: e?.text || q.text, custom: false, edited: !!e, category: e?.category || c.id, home: c.id };
  }));
  const strip = ({ id, text, custom: own, edited }) => ({ id, text, custom: own, edited });
  // Built-in ones in their own category first, then those moved into it, then yours.
  const mine = (cat) => [
    ...seeds.filter((q) => q.category === cat && q.home === cat),
    ...seeds.filter((q) => q.category === cat && q.home !== cat),
    ...custom.filter((q) => q.category === cat).map((q) => ({ id: q.id, text: q.text, custom: true, edited: false })),
  ].map(strip);
  const groups = SEED_CATEGORIES.map((c) => ({ id: c.id, name: c.name, questions: mine(c.id) }));
  const own = mine(CUSTOM_CATEGORY);
  if (own.length) groups.push({ id: CUSTOM_CATEGORY, name: CUSTOM_CATEGORY_NAME, questions: own });
  return groups;
}

// What a new question can be filed under.
export const categoryOptions = () => [
  { id: CUSTOM_CATEGORY, name: CUSTOM_CATEGORY_NAME },
  ...SEED_CATEGORIES.map((c) => ({ id: c.id, name: c.name })),
];

export function answerFor(state, venueId, questionId) {
  const a = state?.answers?.[venueId]?.[questionId];
  return a ? { done: a.done === true, notes: a.notes || '' } : { done: false, notes: '' };
}

/* One answer changed: `patch` is { done } and/or { notes }. Writing the first
   words of an answer ticks the question — on a tour that's one tap fewer —
   and it can still be unticked afterwards. Returns the new state and the
   answer as it should be saved. */
export function setAnswer(state, venueId, questionId, patch) {
  const prev = answerFor(state, venueId, questionId);
  const next = { ...prev };
  if (patch && 'notes' in patch) next.notes = cleanNotes(patch.notes);
  if (patch && 'done' in patch) next.done = patch.done === true;
  else if (!prev.notes && next.notes) next.done = true;
  const answers = { ...(state?.answers || {}) };
  const venue = { ...(answers[venueId] || {}) };
  if (isBlank(next)) delete venue[questionId];
  else venue[questionId] = next;
  if (Object.keys(venue).length) answers[venueId] = venue;
  else delete answers[venueId];
  return { state: { custom: state?.custom || [], edits: state?.edits || {}, answers }, answer: next };
}

/* What to merge-write for that one answer: only its own leaf, so two phones
   answering different questions on the same tour don't undo each other. */
export const answerWrite = (venueId, questionId, answer) => ({
  [QUESTIONS_FIELD]: { answers: { [venueId]: { [questionId]: cleanAnswer(answer) } } },
});

// "12 of 23 answered": the questions ticked for this venue, of those asked now.
export function venueProgress(state, venueId) {
  const groups = questionGroups(state);
  let total = 0;
  let answered = 0;
  for (const g of groups) {
    for (const q of g.questions) {
      total += 1;
      if (answerFor(state, venueId, q.id).done) answered += 1;
    }
  }
  return { answered, total, pct: total ? Math.round((answered / total) * 100) : 0 };
}

export const groupProgress = (state, venueId, group) => ({
  answered: group.questions.filter((q) => answerFor(state, venueId, q.id).done).length,
  total: group.questions.length,
});

/* ── Your own questions (they apply to every venue) ── */

export function addQuestion(state, text, category = CUSTOM_CATEGORY, id = newQuestionId()) {
  const clean = cleanText(text);
  if (!clean) return state;
  return { ...state, custom: [...(state?.custom || []), { id, text: clean, category: cleanCategory(category) }] };
}

/* Reworded or refiled — one of yours, or a built-in one (kept as an edit over
   the original). The id stays, so every venue's answer stays with it. */
export function updateQuestion(state, id, patch) {
  const seed = SEED_BY_ID.get(id);
  if (seed) {
    const cur = state?.edits?.[id] || seed;
    const edits = cleanEdits({
      ...(state?.edits || {}),
      [id]: {
        text: (patch && 'text' in patch ? cleanText(patch.text) : '') || cur.text,
        category: patch && 'category' in patch && CATEGORY_IDS.has(patch.category) ? patch.category : cur.category,
      },
    });
    return { ...state, edits };
  }
  return {
    ...state,
    custom: (state?.custom || []).map((q) => {
      if (q.id !== id) return q;
      const text = patch && 'text' in patch ? cleanText(patch.text) : q.text;
      return { ...q, text: text || q.text, category: patch && 'category' in patch ? cleanCategory(patch.category) : q.category };
    }),
  };
}

// A built-in question put back to how it shipped. Its answers stay.
export function resetQuestion(state, id) {
  if (!state?.edits?.[id]) return state;
  const edits = { ...state.edits };
  delete edits[id];
  return { ...state, edits };
}

export const isBuiltIn = (id) => SEED_BY_ID.has(id);

/* Deleted, with its answers. Only a question of your own can go. Returns the
   new state and the venues that had an answer to it (for the write). */
export function removeQuestion(state, id) {
  const custom = state?.custom || [];
  if (!custom.some((q) => q.id === id)) return { state, venueIds: [] };
  const answers = {};
  const venueIds = [];
  for (const [venueId, byQuestion] of Object.entries(state?.answers || {})) {
    if (!(id in byQuestion)) { answers[venueId] = byQuestion; continue; }
    venueIds.push(venueId);
    const rest = { ...byQuestion };
    delete rest[id];
    if (Object.keys(rest).length) answers[venueId] = rest;
  }
  return { state: { custom: custom.filter((q) => q.id !== id), edits: state?.edits || {}, answers }, venueIds };
}

/* ── The venue picker ──
   Fed by the Venues tab's list. The ones you're going to see come first
   (flagged to visit, or a tour scheduled or done); hidden venues are left
   out unless they already have answers. Each group is sorted by name. */
const TOURING = new Set(['Tour scheduled', 'Toured']);
export function pickerGroups(venues, state) {
  const touring = [];
  const rest = [];
  for (const v of Array.isArray(venues) ? venues : []) {
    if (!v?.id || !str(v.name)) continue;
    if (v.hidden && !state?.answers?.[v.id]) continue;
    (!v.hidden && (v.toVisit || TOURING.has(v.status)) ? touring : rest).push(v);
  }
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  return [
    { label: 'Touring', venues: touring.sort(byName) },
    { label: touring.length ? 'Other venues' : 'Venues', venues: rest.sort(byName) },
  ].filter((g) => g.venues.length);
}

// The venue to show: the one asked for if it's still on the list, else the first.
export function pickVenueId(groups, wanted) {
  const all = groups.flatMap((g) => g.venues);
  return all.some((v) => v.id === wanted) ? wanted : all[0]?.id || '';
}
