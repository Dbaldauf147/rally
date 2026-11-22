// The Secret Santa section of the weekly digest: for each coming event whose
// names have been drawn, the same list the event's Gifts tab shows — who the
// owner drew in each exchange, then Joanne, Mom, Dad and anyone else they're
// buying for — with the gift ideas saved for each on the Friends page.
//
// An event joins the digest once names are drawn for its year and leaves it
// when the day has passed (a yearly event then rolls on to a year with no
// draw yet), so the section runs for the gift-buying stretch and no longer.
import { activeOccurrence, isRecurring } from './recurrence.js';
import { secretSantaEnabled, cleanDraws, drawStoreKey } from './secretSanta.js';
import { giftPeople, giftRelation, findFriend, giftIdeasOf, myPick } from './gifts.js';

const toDate = (v) => {
  if (!v) return null;
  const d = v.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const dayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** The occurrence the Gifts tab would be showing: { year, date, lastDay }, dates null when unset. */
function currentOccurrence(event, today) {
  if (event.dateTBD) return { year: today.getFullYear(), date: null, lastDay: null };
  if (isRecurring(event)) {
    const occ = activeOccurrence(event, today);
    if (occ) return { year: occ.year, date: occ.start, lastDay: occ.end };
  }
  const date = toDate(event.date);
  if (!date) return { year: today.getFullYear(), date: null, lastDay: null };
  return { year: date.getFullYear(), date, lastDay: toDate(event.endDate) || date };
}

/**
 * `events` are the owner's events as { id, ...doc }, `userDoc` their user doc
 * (where the draws live — lib/secretSanta.js), `me` is { uid, email }.
 * Returns, soonest event first:
 *   [{ eventId, title, year, date, daysUntil, rows: [{ role, name, found, ideas }] }]
 * A row with a null `name` is an exchange with no pick for the owner.
 */
export function secretSantaGifts({ events, userDoc, friends, me, today = new Date() }) {
  const start = dayOf(today);
  const data = userDoc && typeof userDoc === 'object' ? userDoc : {};
  const out = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || !secretSantaEnabled(event) || event.cancelled) continue;
    const { year, date, lastDay } = currentOccurrence(event, start);
    if (lastDay && dayOf(lastDay) < start) continue;

    const exchanges = [{ id: '', name: '' }, ...cleanDraws(data.secretSantaDraws?.[event.id])]
      .map((d) => ({ ...d, record: data.secretSanta?.[drawStoreKey(event.id, d.id)]?.[year] }));
    if (!exchanges.some((x) => Array.isArray(x.record?.pairs) && x.record.pairs.length > 0)) continue;

    const person = (role, ref) => {
      const friend = findFriend(friends, ref);
      return { role, name: friend?.name || ref.name || ref.email || 'Someone', found: !!friend, ideas: giftIdeasOf(friend) };
    };
    const rows = [];
    for (const x of exchanges) {
      const role = `Secret Santa pick${x.name ? ` — ${x.name}` : ''}`;
      const pick = myPick(x.record, me);
      if (!pick) { rows.push({ role, name: null, found: false, ideas: [] }); continue; }
      // A pick is stored as it was at the draw; name the guest as they are now.
      const m = event.members?.[pick.key];
      rows.push(person(role, m && typeof m === 'object' ? { name: m.name || pick.name, email: m.email || pick.email } : pick));
    }
    for (const name of giftPeople(data.giftPeople?.[event.id])) {
      rows.push(person(giftRelation(name) || 'Also buying for', { name, email: '' }));
    }

    out.push({
      eventId: event.id,
      title: String(event.title || '').trim() || 'Untitled event',
      year,
      date,
      daysUntil: date ? Math.max(0, Math.round((dayOf(date) - start) / 86400000)) : null,
      rows,
    });
  }
  return out.sort((a, b) => (a.daysUntil ?? Infinity) - (b.daysUntil ?? Infinity) || a.title.localeCompare(b.title));
}
