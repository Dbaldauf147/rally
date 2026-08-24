// Splitting a charge between people, and keeping track of who has paid up.
//
// Money is stored in dollars (that is what arrives from the bank feed) but
// every division happens in whole cents. Splitting $10 three ways in floats
// gives three shares of 3.3333… that add up to $9.999…, and the missing
// fraction turns into a balance that can never be settled — someone is
// forever owed a hundredth of a cent. Rounding to cents and handing the
// remainder to the first few people keeps the shares summing to exactly the
// charge, which is the property that makes "all settled" reachable.
//
// Pure: no React, no Firestore, no DOM.

export const toCents = (dollars) => Math.round((Number(dollars) || 0) * 100);
export const toDollars = (cents) => Math.round(Number(cents) || 0) / 100;

export const money = (dollars) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD',
}).format(Number(dollars) || 0);

/* Divide an amount evenly, in cents, with the remainder spread one cent at a
   time so the parts always add back up to the whole. */
export function evenShares(amount, keys) {
  const people = [...new Set((keys || []).filter(Boolean))];
  if (!people.length) return {};
  const total = toCents(amount);
  const base = Math.floor(total / people.length);
  let extra = total - base * people.length;
  const out = {};
  for (const key of people) {
    out[key] = toDollars(base + (extra > 0 ? 1 : 0));
    if (extra > 0) extra -= 1;
  }
  return out;
}

/* The share map actually in force for an expense.

   'even' recomputes from the current participant list, so adding someone to
   an event re-divides the bill instead of leaving a stale map. 'custom' is
   whatever was typed, with anyone no longer participating dropped. */
export function resolveShares(expense, participantKeys) {
  const keys = (participantKeys && participantKeys.length)
    ? participantKeys
    : Object.keys(expense?.shares || {});
  if (!expense) return {};
  if (expense.splitMode === 'custom' && expense.shares) {
    const out = {};
    for (const key of keys) {
      if (expense.shares[key] != null) out[key] = Number(expense.shares[key]) || 0;
    }
    return out;
  }
  return evenShares(expense?.amount, keys);
}

export const sumShares = (shares) => toDollars(
  Object.values(shares || {}).reduce((acc, v) => acc + toCents(v), 0),
);

/* What is still unassigned (positive) or over-assigned (negative). A custom
   split that doesn't add up is the single easiest way to lose money in a
   ledger like this, so the editor shows this number at all times. */
export const unassigned = (expense, shares) => toDollars(
  toCents(expense?.amount) - toCents(sumShares(shares)),
);

export const isSettled = (expense, key) => !!expense?.settled?.[key];

/* Per-person totals across many expenses.

   The payer is excluded from what they are owed: their own share of a bill
   they paid is not a debt, it is just their money. */
export function balances(expenses, participantsFor) {
  const out = new Map();
  const bump = (key, field, amount) => {
    if (!out.has(key)) out.set(key, { key, owed: 0, settledAmount: 0, outstanding: 0, count: 0 });
    const row = out.get(key);
    row[field] = toDollars(toCents(row[field]) + toCents(amount));
  };

  for (const expense of expenses || []) {
    const keys = participantsFor ? participantsFor(expense) : Object.keys(expense.shares || {});
    const shares = resolveShares(expense, keys);
    const payer = expense.paidBy || null;
    for (const [key, amount] of Object.entries(shares)) {
      if (key === payer) continue;
      bump(key, 'owed', amount);
      if (isSettled(expense, key)) bump(key, 'settledAmount', amount);
      else bump(key, 'outstanding', amount);
      out.get(key).count += 1;
    }
  }
  return [...out.values()].sort((a, b) => b.outstanding - a.outstanding);
}

/* Headline numbers for one expense: what it cost, what is still owed on it,
   and whether everyone has squared up. */
export function expenseStatus(expense, participantKeys) {
  const shares = resolveShares(expense, participantKeys);
  const payer = expense?.paidBy || null;
  let outstanding = 0;
  let owedTotal = 0;
  let people = 0;
  for (const [key, amount] of Object.entries(shares)) {
    if (key === payer) continue;
    people += 1;
    owedTotal = toDollars(toCents(owedTotal) + toCents(amount));
    if (!isSettled(expense, key)) outstanding = toDollars(toCents(outstanding) + toCents(amount));
  }
  return {
    shares,
    people,
    owedTotal,
    outstanding,
    // An expense nobody else is on isn't "settled", it just isn't split yet.
    fullySettled: people > 0 && outstanding === 0,
    unsplit: people === 0,
  };
}
