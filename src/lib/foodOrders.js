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
//   members.<key>.foodOrder = { choice, text, at }
// `choice` is an option id; `text` is a meal written out in full. Keeping it on
// the member row is what makes a texted ?vid= link enough: the order lands on
// the right person with nothing to reconcile afterwards.
//
// The two fields exist because the two sides of this ask different questions.
// A guest gets a list and picks one — that is what keeps the totals countable.
// The organiser gets a box they can type anything into, because half the
// orders arrive as "he says he'll have the salmon" and the menu was never
// going to cover it. Typing a name that is on the menu resolves to that
// option, so it still counts toward the same line.

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
// an empty pick is "not yet", not an order for nothing.
//
// `__`-prefixed choices are the old "something else" sentinel: they never named
// a real option, so the words that went with them become the typed meal. That
// keeps orders taken before the write-in moved to the organiser's side.
export function normalizeOrder(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let choice = String(raw.choice ?? '').trim();
  let text = String(raw.text ?? '').trim();
  if (choice.startsWith('__')) {
    if (!text) text = String(raw.other ?? '').trim();
    choice = '';
  }
  if (!choice && !text) return null;
  return { choice, text, at: raw.at || null };
}

// What to show in the table for one order. An option since deleted from the
// menu falls back to whatever was typed, and failing that reads as no order
// rather than a blank row that looks like a bug.
export function orderLabel(order, menu) {
  if (!order) return '';
  const opt = order.choice ? menu.options.find(o => o.id === order.choice) : null;
  return opt ? opt.label : (order.text || '');
}

// The option a typed meal names, if it names one. Typing "cheeseburger" when
// Cheeseburger is on the menu should count on that line rather than starting a
// line of its own, so the totals don't split over capitalisation.
export function matchOption(text, menu) {
  const want = String(text || '').trim().toLowerCase();
  if (!want) return null;
  return menu.options.find(o => o.label.trim().toLowerCase() === want) || null;
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

  // Totals per menu option first — a kitchen order reads "6 burgers, 3 salads"
  // — then anything typed out in full, grouped so two people down for salmon
  // read as one line of two rather than two lines of one.
  const onMenu = menu.options.map(o => ({
    id: o.id,
    label: o.label,
    count: ordered.filter(r => r.order.choice === o.id).length,
  })).filter(c => c.count > 0);

  const typed = [];
  for (const r of ordered) {
    if (r.order.choice || !r.label) continue;
    const key = r.label.toLowerCase();
    const seen = typed.find(t => t.key === key);
    if (seen) seen.count++;
    else typed.push({ id: `typed:${key}`, key, label: r.label, count: 1 });
  }

  return {
    menu,
    rows,
    orderedCount: ordered.length,
    total: rows.length,
    waiting,
    counts: [...onMenu, ...typed.map(({ id, label, count }) => ({ id, label, count, typed: true }))],
  };
}

// "6 × Cheeseburger, 3 × Caesar salad" — the line you read out to whoever is
// taking the order.
export function tallyText(summary) {
  return summary.counts.map(c => `${c.count} × ${c.label}`).join(', ');
}
