// Keeping an event out of somebody's sight.
//
// A surprise party is the case this exists for: the person it's for is on the
// guest list, with their name, their email and their RSVP, and they must not
// see the event while it's being arranged. So the event carries `hiddenFrom`,
// a list of email addresses, and everything that shows or sends an event to a
// person checks it: their dashboard and plans, the event page itself, and the
// reminder emails the cron sends.
//
// What this is not: a permission. `firestore.rules` lets anyone read an event
// document (the date poll has to work for people with no account at all), so
// hiding is what the app shows, not what the database will hand over. Someone
// who goes looking with the event's id can still read it. It hides a surprise
// from someone using Rally normally; it does not keep a secret from someone
// who is trying.

export const cleanEmail = (raw) => String(raw ?? '').trim().toLowerCase();

/* The stored list: lowercased, de-duplicated, and only things that look like an
   address — a half-typed name in here would hide the event from nobody and
   quietly sit there looking like it had worked. */
export function normalizeHiddenFrom(raw) {
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach((v) => {
    const email = cleanEmail(v);
    if (email.includes('@') && !out.includes(email)) out.push(email);
  });
  return out;
}

export const isHiddenFrom = (event, email) => {
  const who = cleanEmail(email);
  return !!who && normalizeHiddenFrom(event?.hiddenFrom).includes(who);
};

// The events this person may see, for a dashboard or a list.
export const visibleEvents = (events, email) =>
  (events || []).filter((e) => !isHiddenFrom(e, email));

/* Hide the event from one more person.

   The organizer can't be hidden from their own event: they'd lose the event
   and the control that would let them undo it. Whoever is doing the hiding is
   refused for the same reason. */
export function addHiddenFrom(hiddenFrom, email, { except = [] } = {}) {
  const who = cleanEmail(email);
  const blocked = except.map(cleanEmail).filter(Boolean);
  if (!who.includes('@') || blocked.includes(who)) return normalizeHiddenFrom(hiddenFrom);
  return normalizeHiddenFrom([...(hiddenFrom || []), who]);
}

export const removeHiddenFrom = (hiddenFrom, email) =>
  normalizeHiddenFrom(hiddenFrom).filter((e) => e !== cleanEmail(email));

/* Who on the guest list this event is hidden from, for saying so on the page.
   Anyone hidden who isn't a member is listed by their address alone. */
export function hiddenPeople(event) {
  const hidden = normalizeHiddenFrom(event?.hiddenFrom);
  const byEmail = new Map();
  Object.values(event?.members || {}).forEach((m) => {
    if (!m || typeof m !== 'object') return;
    const email = cleanEmail(m.email);
    if (email && !byEmail.has(email)) byEmail.set(email, m.name || '');
  });
  return hidden.map((email) => ({ email, name: byEmail.get(email) || '' }));
}
