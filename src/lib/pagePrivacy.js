// Which pages the owner has taken private — the route-key half.
//
// Pure: no React, no Firestore, no DOM, so it can be unit-tested. Reading and
// writing the shared config doc lives in pagePrivacyStore.js, which imports
// firebase.js and therefore can't be loaded under vitest.
//
// WHAT THIS IS NOT: a security boundary. It stops a page and its nav link from
// rendering for anyone but the owner, which is what "only I can see this page"
// means in practice. It does not restrict the data behind the page: Firestore
// rules still decide who can read `events`, `expenses` and the rest, and
// anything readable there stays readable to a determined user regardless of
// what this doc says. Pages whose *data* must be private need a rules change
// too — the Prep Day date-spots endpoint is the worked example, where the
// server rejects non-owner tokens outright.

export const OWNER_EMAIL = 'baldaufdan@gmail.com';

export const isOwnerEmail = (email) => (email || '').trim().toLowerCase() === OWNER_EMAIL;

/* Pages are keyed by their first path segment, so every /event/:id shares one
   key rather than seeding a doc entry per event. Marking "event" private
   therefore hides all event pages, which is the only reading of "this page"
   that stays true as the ids change. */
export function pageKey(pathname) {
  const first = String(pathname || '/').split('?')[0].split('/').filter(Boolean)[0];
  return (first || 'dashboard').toLowerCase();
}

// Display names for the toggle. A key with no entry falls back to itself, so a
// route added later still gets a usable button without touching this map.
const LABELS = {
  dashboard: 'Dashboard',
  calendar: 'Rally Calendar',
  plans: 'Plans',
  voting: 'Voting',
  friends: 'Friends',
  expenses: 'Trip Expenses',
  wedding: 'Wedding',
  'travel-list': 'Travel List',
  holidays: 'Holidays',
  recurring: 'Repeating',
  pto: 'PTO',
  doctors: 'Doctors',
  reachout: 'Reach Out',
  sports: 'Sports',
  admin: 'Admin',
  event: 'Event pages',
  trip: 'Trip pages',
};

export const pageLabel = (key) => LABELS[key] || key;

// Routes that are reachable without signing in (invites, polls, the share
// target). Hiding those would break links already sent to other people, so the
// toggle doesn't offer it.
const NEVER_PRIVATE = new Set(['login', 'invite', 'poll', 'boat', 'share']);

export const canBePrivate = (key) => !NEVER_PRIVATE.has(key);
