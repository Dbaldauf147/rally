// Meals for an event: the menu the organiser sets, and what each guest picked
// off it.
//
// Pure — no Firestore, no React — so the counts can be unit-tested and the same
// summary drives the Meals tab's table, its bullets, and anything else that
// needs to know who has ordered.
//
// Storage. The menu is one field on the event:
//   event.foodMenu = { enabled, prompt, options: [{ id, label }] }
// and an order rides on the member row it belongs to, beside their rsvp and
// their votes:
//   members.<key>.foodOrder = { choice, at }
// `choice` is an option id. Keeping it on the member row is what makes a texted
// ?vid= link enough: the order lands on the right person with nothing to
// reconcile afterwards.
//
// An order is a menu pick and nothing else. There was briefly a "something
// else" write-in and a per-person note; both are gone, so what comes back is
// always one of the options you set — which is what makes the tally a thing you
// can hand to whoever is cooking without reading it first.

export const newOptionId = () =>
  (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `opt-${Math.random().toString(36).slice(2)}-${Date.now()}`);

export const DEFAULT_PROMPT = 'What would you like?';

// Whatever is on the event, in the shape the UI can rely on.
export function normalizeMenu(raw) {
  const options = Array.isArray(raw?.options)
    ? raw.options
        .filter(o => o && typeof o === 'object')
        // A blank label is an option the organiser has just added and has not
        // typed into yet. Dropping it here would delete the row out from under
        // them; it is filtered at the point of offering instead.
        .map(o => ({ id: String(o.id || newOptionId()), label: String(o.label ?? '') }))
    : [];
  return {
    enabled: !!raw?.enabled,
    prompt: String(raw?.prompt ?? '').trim() || DEFAULT_PROMPT,
    options,
  };
}

// The options worth putting in front of a guest: the ones that have been named.
export const offerableOptions = (menu) => menu.options.filter(o => o.label.trim());

// One member's stored order, tidied. Returns null when they haven't ordered —
// an empty pick is "not yet", not an order for nothing. Orders written under
// the old write-in ("something else") carried no option id, so they read as not
// having ordered and the person is asked again.
export function normalizeOrder(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const choice = String(raw.choice ?? '').trim();
  if (!choice || choice.startsWith('__')) return null;
  return { choice, at: raw.at || null };
}

// What to show in the table for one order. An option since deleted from the
// menu leaves nothing to name, so it reads as no order rather than as a blank
// row that looks like a bug.
export function orderLabel(order, menu) {
  if (!order) return '';
  const opt = menu.options.find(o => o.id === order.choice);
  return opt ? opt.label : '';
}

// Per-person vote counts, built from the event's date options. Mirrors what
// EventDetail keeps in state, extracted so the guest-facing meal link can work
// out the same answer without duplicating the rule.
export function buildVoteStats(options = []) {
  const stats = {};
  for (const o of options) {
    if (!o || o.closed || o.noVote) continue;
    for (const [voterId, v] of Object.entries(o.votes || {})) {
      if (!v?.vote || v.vote === 'none') continue;
      if (!stats[voterId]) stats[voterId] = { total: 0, yes: 0, maybe: 0, no: 0 };
      stats[voterId].total++;
      if (v.vote === 'yes') stats[voterId].yes++;
      else if (v.vote === 'maybe') stats[voterId].maybe++;
      else if (v.vote === 'no') stats[voterId].no++;
    }
  }
  return stats;
}

// Is this person eating? Only a yes or a maybe is, which is the whole point of
// asking after the vote: you order for the people who are coming, not for the
// list you started with. A manual Going / Not going always wins; failing that a
// yes or maybe on any open date counts, including one inherited from a linked
// +1 partner, so half a couple isn't left out of dinner.
export function isYesMaybe(uid, m, members = {}, voteStats = {}) {
  if (!m || m.skipVote) return false;
  if (m.attendance === 'going') return true;
  if (m.attendance === 'notgoing') return false;
  const vs = voteStats[uid];
  if (vs && (vs.yes > 0 || vs.maybe > 0)) return true;
  const partnerUid = m.plusOneOf
    || Object.entries(members).find(([, mm]) => mm && typeof mm === 'object' && mm.plusOneOf === uid)?.[0];
  const pv = partnerUid ? voteStats[partnerUid] : null;
  return !!pv && (pv.yes > 0 || pv.maybe > 0);
}

// Everyone who is eating, what they picked, and the totals.
//
// Only yes/maybe attendees appear. A plus-one inherits their host's order,
// because one person orders for both.
export function summarizeOrders(event = {}, menuRaw = undefined, voteStats = {}) {
  const menu = normalizeMenu(menuRaw === undefined ? event.foodMenu : menuRaw);
  const members = event.members || {};

  const rows = Object.entries(members)
    .filter(([, m]) => m && typeof m === 'object' && (m.name || m.email))
    .filter(([uid, m]) => isYesMaybe(uid, m, members, voteStats))
    .map(([key, m]) => {
      const own = normalizeOrder(m.foodOrder);
      const host = m.plusOneOf ? normalizeOrder(members[m.plusOneOf]?.foodOrder) : null;
      const order = own || host;
      return {
        key,
        name: m.name || m.email || 'Unnamed',
        order,
        inherited: !own && !!host,
        label: orderLabel(order, menu),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const ordered = rows.filter(r => r.order);
  const waiting = rows.filter(r => !r.order).map(r => r.name);

  // Totals per menu option — a kitchen order reads "6 burgers, 3 salads".
  const counts = menu.options.map(o => ({
    id: o.id,
    label: o.label,
    count: ordered.filter(r => r.order.choice === o.id).length,
  })).filter(c => c.count > 0);

  return { menu, rows, orderedCount: ordered.length, total: rows.length, waiting, counts };
}

// "6 × Cheeseburger, 3 × Caesar salad" — the line you read out to whoever is
// taking the order.
export function tallyText(summary) {
  return summary.counts.map(c => `${c.count} × ${c.label}`).join(', ');
}
