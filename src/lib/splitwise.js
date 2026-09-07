// Sending a Rally charge to Splitwise.
//
// One way, on purpose. Rally is where the split is decided — it knows who is a
// yes on the dates, who is somebody's +1, who you took off the beer run — and
// Splitwise is where the people who live in Splitwise can see what they owe.
// Pulling settlements back would mean a stored mapping, a cron, and a rule for
// who wins when both sides change the same number, which is a lot of machinery
// for a second copy of a ledger you already have.
//
// Splitwise wants the shares flattened into indexed keys rather than nested:
//   users__0__user_id, users__0__paid_share, users__0__owed_share
// and it insists the paid shares and the owed shares each add up to the cost,
// to the cent. Rally's resolveShares already divides exactly, so the arithmetic
// lines up — but it is checked here anyway, because Splitwise answers a bad
// split with HTTP 200 and an errors array, which is an easy way to think you
// sent something you didn't.
//
// Pure: no fetch, no React, no Firestore.

import { toCents, toDollars } from './expenses';

export const SPLITWISE_API = 'https://secure.splitwise.com/api/v3.0';

// Splitwise takes money as a decimal string. Formatting from cents rather than
// the float keeps "16.25" from ever being written as "16.249999999999998".
const amountStr = (dollars) => (toCents(dollars) / 100).toFixed(2);

/* Line up Rally's people with the members of a Splitwise group.

   Matched on email, lower-cased — the only identifier both sides reliably
   hold. Anyone without an email on their Rally row, or whose email isn't in
   the group, comes back in `unmatched` so the UI can name them rather than
   quietly sending a split that leaves them out.

   `self` is the exception: { key, splitwiseId } saying which Rally person is
   the account the API key belongs to. That is knowable without an email, and
   worth knowing, because the person holding the key is nearly always the one
   who paid — and an organiser's own member row is exactly the one likely to
   have no email on it, since they never invited themselves. */
export function matchGroupMembers(people, groupMembers, self = null) {
  const byEmail = new Map();
  for (const m of groupMembers || []) {
    const email = String(m?.email || '').trim().toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, m);
  }
  const inGroup = new Set((groupMembers || []).map(m => m?.id).filter(id => id != null));
  const selfKey = self?.key ?? null;
  const selfId = self?.splitwiseId ?? null;

  const matched = new Map();
  const unmatched = [];
  for (const person of people || []) {
    if (selfKey && person?.key === selfKey && selfId != null && inGroup.has(selfId)) {
      matched.set(person.key, { ...person, splitwiseId: selfId });
      continue;
    }
    const email = String(person?.email || '').trim().toLowerCase();
    const hit = email ? byEmail.get(email) : null;
    if (hit?.id != null) matched.set(person.key, { ...person, splitwiseId: hit.id });
    else unmatched.push(person);
  }
  return { matched, unmatched };
}

/* The form body for POST /create_expense.

   `shares` is Rally's key → dollars map, `payerKey` whoever fronted it. The
   payer is down for the whole cost as paid and their own share as owed; every
   other person paid nothing and owes their share. That is exactly how
   Splitwise reads "Dan paid and split it".

   Throws rather than returning a half-built body: a split that doesn't add up
   is not something to send and let the server sort out. */
export function buildExpense({ description, amount, date, groupId, shares, payerKey, matched, currency = 'USD' }) {
  const cost = toCents(amount);
  if (!(cost > 0)) throw new Error('That charge has no amount to split.');
  if (!groupId) throw new Error('Pick a Splitwise group first.');

  const entries = Object.entries(shares || {})
    .filter(([key, value]) => matched.has(key) && toCents(value) > 0);
  if (!entries.length) throw new Error('Nobody on this charge is in that Splitwise group.');

  const payer = matched.get(payerKey);
  if (!payer) throw new Error('Whoever paid isn’t in that Splitwise group.');
  if (!entries.some(([key]) => key === payerKey)) {
    throw new Error('Whoever paid has to be in on the charge.');
  }

  const owedTotal = entries.reduce((acc, [, value]) => acc + toCents(value), 0);
  if (owedTotal !== cost) {
    throw new Error(
      `The shares come to ${toDollars(owedTotal)} but the charge is ${toDollars(cost)}`
      + ' — square them up before sending.',
    );
  }

  const body = {
    cost: amountStr(amount),
    description: String(description || '').trim() || 'Untitled charge',
    group_id: groupId,
    currency_code: currency,
  };
  if (date) body.date = `${date}T12:00:00Z`; // midday, so a timezone can't shunt it a day

  entries.forEach(([key, value], i) => {
    const person = matched.get(key);
    body[`users__${i}__user_id`] = person.splitwiseId;
    body[`users__${i}__paid_share`] = key === payerKey ? amountStr(toDollars(cost)) : '0.00';
    body[`users__${i}__owed_share`] = amountStr(value);
  });

  return body;
}

/* Splitwise answers a rejected write with HTTP 200 and a populated `errors`,
   so "did it work" is a question about the body, not the status. */
export function readErrors(payload) {
  const errors = payload?.errors;
  if (!errors) return '';
  if (Array.isArray(errors)) return errors.join(' ');
  if (typeof errors === 'string') return errors;
  const parts = [];
  for (const [field, list] of Object.entries(errors)) {
    const text = Array.isArray(list) ? list.join(', ') : String(list);
    if (text) parts.push(field === 'base' ? text : `${field}: ${text}`);
  }
  return parts.join(' · ');
}
