/* The outreach email sent to wedding venues — the first email, asking whether
   the venue could work and what it costs: the details a venue needs to quote (date,
   head count, ceremony, budget…), and an email template built from them that
   can be reworded freely. Kept on the user doc as

     weddingVenueReply: { details: { key: text… }, drafts: [{ id, name, template, subject }] }

   The details are shared; each draft is one email written from them (the
   first outreach, a follow-up, a "we've booked elsewhere"…). A blank template
   means "the one built from the details", so editing a detail flows into the
   email until the template itself is edited; a blank subject means the
   standard one. Before there were several drafts the one email was kept as
   `template` beside the details — that still reads as the first draft, and
   is still written, as the first draft's text.

   In the template, {first name} and {venue} are filled in for each venue.
   Pure, so it's shared by the page and the server (api/wedding-venues.js). */

import { cleanDate } from './weddingTimeline.js';
import { guestCounts, headcount, normalizePlan } from './weddingBudgetPlan.js';

export const REPLY_FIELDS = [
  { key: 'couple', label: 'Our names', placeholder: 'Dan & Jo' },
  { key: 'date', label: 'Date', placeholder: 'A Saturday in September 2027' },
  { key: 'flexibility', label: 'Flexibility', placeholder: 'Open to a Friday or Sunday, or late August to early October' },
  { key: 'guests', label: 'Guest count', placeholder: 'About 180' },
  { key: 'ceremony', label: 'Ceremony', placeholder: 'On site, outdoors if the weather allows, with an indoor backup' },
  { key: 'style', label: 'What we have in mind', placeholder: 'Cocktail hour, seated dinner and dancing; relaxed, by the water' },
  { key: 'budget', label: 'Budget', placeholder: 'Leave blank to keep it out of the email' },
  { key: 'questions', label: 'What we want to know', multiline: true },
  { key: 'phone', label: 'Best phone number', placeholder: 'Optional' },
  { key: 'signoff', label: 'Sign-off', multiline: true, placeholder: 'Thanks so much,\nDan' },
];

// What every venue gets asked unless it's reworded.
export const DEFAULT_QUESTIONS = [
  'Is the date (or any of the dates around it) open?',
  'Pricing for that date: the site fee or food and beverage minimum, and the per-person price',
  'Is it all-inclusive (food, bar, staff, tables and linens), or what do we bring in ourselves?',
  'Service charge, tax and any other fees on top',
  'Seated capacity with a dance floor, and the plan if it rains',
  'A sample package or menu, and when we could come for a tour',
].join('\n');

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const KEYS = REPLY_FIELDS.map((f) => f.key);

export const FIRST_DRAFT = { id: 'outreach', name: 'Outreach' };
export const MAX_DRAFTS = 20;
const text = (v) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n') : '');

// The saved drafts, each with an id of its own; with none saved, the one
// email kept as `template` (or the one built from the details).
function normalizeDrafts(r) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(r.drafts) ? r.drafts : []) {
    if (!x || typeof x !== 'object' || out.length >= MAX_DRAFTS) continue;
    let id = str(x.id);
    for (let n = out.length + 1; !id || seen.has(id); n += 1) id = `draft-${n}`;
    seen.add(id);
    out.push({ id, name: str(x.name) || `Draft ${out.length + 1}`, template: text(x.template), subject: str(x.subject) });
  }
  return out.length ? out : [{ ...FIRST_DRAFT, template: text(r.template), subject: '' }];
}

export function normalizeReplySettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = r.details && typeof r.details === 'object' ? r.details : {};
  const details = {};
  for (const k of KEYS) details[k] = typeof d[k] === 'string' ? d[k].replace(/\r\n/g, '\n').trim() : '';
  if (!('questions' in d)) details.questions = DEFAULT_QUESTIONS;
  const drafts = normalizeDrafts(r);
  return { details, template: drafts[0].template, drafts };
}

// What the page saves: the drafts, and the first one's text under its old name.
export const replySettingsToSave = (details, drafts) => ({ details, drafts, template: drafts[0]?.template || '' });

// An id no other draft has.
export function newDraftId(drafts = []) {
  const ids = new Set(drafts.map((d) => d.id));
  for (let n = drafts.length + 1; ; n += 1) if (!ids.has(`draft-${n}`)) return `draft-${n}`;
}

// The draft with this id, else the first.
export function draftOf(settings, id) {
  const list = Array.isArray(settings?.drafts) && settings.drafts.length ? settings.drafts : [{ ...FIRST_DRAFT, template: text(settings?.template), subject: '' }];
  return list.find((d) => d.id === id) || list[0];
}

/* Fill in what's blank from elsewhere on the Wedding page: the date the
   timeline counts back from, and the budget plan's head count. Only blanks —
   anything typed here wins. */
export function prefillDetails(details, { weddingDate, guestCount } = {}) {
  const out = { ...details };
  const d = cleanDate(weddingDate);
  if (!out.date && d) {
    const t = new Date(`${d}T12:00:00`);
    out.date = t.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  if (!out.guests && Number(guestCount) > 0) out.guests = `About ${Math.round(Number(guestCount))}`;
  return out;
}

/* The settings as they're used, from the whole user doc: what's saved, with
   blanks filled from the timeline and budget. The page shows this and the
   server drafts from it, so the two can't disagree. */
export function replySettingsFor(userData = {}) {
  const s = normalizeReplySettings(userData?.weddingVenueReply);
  let guestCount = 0;
  try {
    const plan = normalizePlan(userData?.weddingBudgetPlan);
    guestCount = headcount(plan.guests, guestCounts(Array.isArray(userData?.weddingContacts) ? userData.weddingContacts : []));
  } catch { /* no budget plan yet */ }
  return { ...s, details: prefillDetails(s.details, { weddingDate: userData?.weddingTimeline?.date, guestCount }) };
}

const bullets = (text) => str(text).split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);

// The email the details add up to, with {first name} and {venue} left to fill.
export function buildTemplate(details = {}) {
  const d = Object.fromEntries(KEYS.map((k) => [k, str(details[k])]));
  const facts = [
    d.date && `Date: ${d.date}${d.flexibility ? ` (${d.flexibility.replace(/^\(|\)$/g, '')})` : ''}`,
    !d.date && d.flexibility && `Dates: ${d.flexibility}`,
    d.guests && `Guests: ${d.guests}`,
    d.ceremony && `Ceremony: ${d.ceremony}`,
    d.style && `What we have in mind: ${d.style}`,
    d.budget && `Budget: ${d.budget}`,
  ].filter(Boolean);
  const qs = bullets(d.questions);
  const parts = [
    'Hi {first name},',
    `We${d.couple ? ` (${d.couple})` : ''} are planning our wedding and {venue} is high on our list. We'd love to find out whether it could work for us — here are the details so you can put a quote together.`,
  ];
  if (facts.length) parts.push(facts.map((f) => `• ${f}`).join('\n'));
  if (qs.length) parts.push(`Could you let us know:\n${qs.map((q) => `• ${q}`).join('\n')}`);
  parts.push(`Happy to jump on a call if that's easier${d.phone ? ` — the best number for us is ${d.phone}` : ''}.`);
  parts.push(d.signoff || `Thanks so much,\n${d.couple ? d.couple.split(/\s*(?:&|and)\s*/)[0] : ''}`.trim());
  return parts.join('\n\n');
}

export function templateOf(settings, draftId) {
  const d = draftOf(settings, draftId);
  return str(d.template) ? d.template : buildTemplate(settings?.details);
}

// A draft's subject: its own, else the standard outreach one.
export const subjectOf = (settings, draftId) => str(draftOf(settings, draftId).subject) || outreachSubject(settings?.details);

export function firstName(name) {
  const s = str(name).replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '');
  return s.split(/\s+/)[0] || '';
}

// The template for one venue. With no contact name it opens "Hi there,".
export function fillTemplate(template, venue = {}) {
  const first = firstName(venue.contactName);
  return String(template || '')
    .replace(/Hi \{first name\},/g, first ? `Hi ${first},` : 'Hi there,')
    .replace(/\{first name\}/gi, first || 'there')
    .replace(/\{venue\}/gi, str(venue.name) || 'your venue');
}

// The subject of a new outreach email: "Wedding inquiry for Saturday, …".
export function outreachSubject(details = {}) {
  const date = str(details?.date);
  return `Wedding inquiry${date ? ` for ${date}` : ''}`;
}

// A saved template that still reads as a reply to the venue (written before
// the email became an outreach), so the page can offer to rebuild it.
export const readsAsReply = (template) => /getting back to us|thanks? (?:you )?for (?:your|the) (?:reply|email|response|note)|^re:/im.test(str(template));

export function replySubject(threadSubject, venueName) {
  const s = str(threadSubject);
  if (s) return /^re:/i.test(s) ? s : `Re: ${s}`;
  return `Wedding inquiry${venueName ? ` — ${str(venueName)}` : ''}`;
}
