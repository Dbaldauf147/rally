// Food orders for an event: the menu the organiser sets, and what each guest
// picked off it.
//
// Pure — no Firestore, no React — so the counts can be unit-tested and the same
// summary drives the organiser's table, the tally, and anything else that needs
// to know who has ordered.
//
// Storage. The menu is one field on the event:
//   event.foodMenu = { enabled, prompt, options: [{ id, label }] }
// and an order rides on the member row it belongs to, beside their rsvp and
// their votes:
//   members.<key>.foodOrder = { choice, other, note, at }
// `choice` is an option id, or the sentinel OTHER when they wrote their own.
// Keeping it on the member row is what makes a texted ?vid= link enough: the
// order lands on the right person with nothing to reconcile afterwards.

export const OTHER = '__other__';

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
export function normalizeOrder(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const choice = String(raw.choice ?? '').trim();
  const other = String(raw.other ?? '').trim();
  const note = String(raw.note ?? '').trim();
  if (!choice && !other) return null;
  // "Something else" with nothing written in it is not an order either.
  if (choice === OTHER && !other) return null;
  return { choice, other, note, at: raw.at || null };
}

// What to show in the table for one order. An option that has since been
// deleted from the menu still reads as what they picked, not as a blank.
export function orderLabel(order, menu) {
  if (!order) return '';
  if (order.choice === OTHER || !order.choice) return order.other;
  const opt = menu.options.find(o => o.id === order.choice);
  return opt ? opt.label : (order.other || 'No longer on the menu');
}

// Everyone who could order, what they picked, and the totals.
//
// Mirrors the poll's idea of who counts: skipVote sits out, and a plus-one
// inherits their host's order, because one person orders for both.
export function summarizeOrders(event = {}, menuRaw = undefined) {
  const menu = normalizeMenu(menuRaw === undefined ? event.foodMenu : menuRaw);
  const members = event.members || {};

  const rows = Object.entries(members)
    .filter(([, m]) => m && typeof m === 'object' && !m.skipVote && (m.name || m.email))
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
        note: order?.note || '',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const ordered = rows.filter(r => r.order);
  const waiting = rows.filter(r => !r.order).map(r => r.name);

  // Totals per menu option, then anything written in freehand, so a kitchen
  // order reads "6 burgers, 3 salads" and the oddities are listed after.
  const counts = menu.options.map(o => ({
    id: o.id,
    label: o.label,
    count: ordered.filter(r => r.order.choice === o.id).length,
  })).filter(c => c.count > 0);
  const others = ordered
    .filter(r => r.order.choice === OTHER || !menu.options.some(o => o.id === r.order.choice))
    .map(r => r.label)
    .filter(Boolean);

  return { menu, rows, orderedCount: ordered.length, total: rows.length, waiting, counts, others };
}

// "6 × Cheeseburger, 3 × Caesar salad, 1 × poke bowl" — the line you read out
// to whoever is taking the order.
export function tallyText(summary) {
  const parts = summary.counts.map(c => `${c.count} × ${c.label}`);
  for (const o of summary.others) parts.push(`1 × ${o}`);
  return parts.join(', ');
}
