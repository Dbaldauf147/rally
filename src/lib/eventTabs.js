// The event page's optional tabs: Meals, Notes, Expenses, Chat.
//
// A dinner doesn't need an expenses ledger and a Secret Santa doesn't need a
// meal count, so these four are switched on per event (Edit Event → "Tabs")
// rather than shown on everything. The choice is stored on the event as
// `tabs: { meals, notes, expenses, chat }`.
//
// An event from before the switches existed has no entry for a tab. Those
// tabs used to be on every page, so to hide nothing that's in use, an unset
// tab shows exactly when it has something in it. Once a tab is switched on or
// off by hand, that choice wins — switching one off hides it and keeps what's
// in it.
//
// Meals and Notes keep their content on the event itself. Chat and Expenses
// keep theirs elsewhere, so the page looks that up and passes it in (`found`).
//
// Day is the fifth. It is the itinerary laid out one day at a time, so an
// unset Day tab follows the trip planning (lib/eventPlanning.js): there when
// the event plans a trip or already has an itinerary, and it has a date.
// Switched off, the tab leaves the bar but the itinerary's own "Day view"
// buttons still open it.
//
// Pure: no React, no Firestore.

import { showsTripPlanning } from './eventPlanning.js';

export const OPTIONAL_TABS = [
  { key: 'day', label: 'Day', icon: '📅' },
  { key: 'meals', label: 'Meals', icon: '🍽' },
  { key: 'notes', label: 'Notes', icon: '📝' },
  { key: 'expenses', label: 'Expenses', icon: '💵' },
  { key: 'chat', label: 'Chat', icon: '💬' },
];
const KEYS = OPTIONAL_TABS.map((t) => t.key);

/** The stored choice for one tab: true, false, or null when never set. */
export function tabSetting(event, key) {
  const v = event?.tabs?.[key];
  return v === true || v === false ? v : null;
}

const hasOrder = (m) => {
  const o = m?.foodOrder;
  return !!o && typeof o === 'object' && (String(o.choice ?? '').trim() !== '' || String(o.text ?? '').trim() !== '' || String(o.other ?? '').trim() !== '');
};

/** What can be told from the event alone: is there anything for Day / Meals / Notes? */
export function eventTabContent(event) {
  const menu = event?.foodMenu;
  const meals = !!menu?.enabled
    || (Array.isArray(menu?.options) && menu.options.length > 0)
    || Object.values(event?.members || {}).some(hasOrder);
  const notes = Array.isArray(event?.notes) && event.notes.length > 0;
  const day = !!event?.date && showsTripPlanning(event);
  return { day, meals, notes };
}

/**
 * Which optional tabs the page shows: { day, meals, notes, expenses, chat }.
 * `found` is what the page learned about content kept off the event —
 * { chat, expenses } — and may be partial or empty while it's still looking.
 */
export function shownTabs(event, found = {}) {
  const content = { ...eventTabContent(event), chat: !!found.chat, expenses: !!found.expenses };
  const out = {};
  for (const key of KEYS) out[key] = tabSetting(event, key) ?? content[key];
  return out;
}

/**
 * What the form saves. A new event gets all four spelled out. An edit writes
 * only the boxes that changed, as dotted paths, so an untouched tab stays
 * unset (and keeps following its content) and the others aren't rewritten.
 */
export function tabsForSave(ticked, initial, isNew) {
  if (isNew) return { tabs: Object.fromEntries(KEYS.map((k) => [k, !!ticked[k]])) };
  const out = {};
  for (const key of KEYS) if (!!ticked[key] !== !!initial[key]) out[`tabs.${key}`] = !!ticked[key];
  return out;
}
