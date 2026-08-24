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

// Multiplying by 100 first is not enough: 1.005 is really 1.00499999999999989
// in binary, so a plain round gives 100 cents instead of 101 and half a cent
// vanishes. Fixing to two decimals before rounding pins the value to what the
// number was written as. Half-cent inputs shouldn't reach here — bank feeds
// and the share inputs are both two-decimal — but a rounding rule that is
// wrong only sometimes is the worst kind to debug.
export const toCents = (dollars) => Math.round(Number(((Number(dollars) || 0) * 100).toFixed(2)));
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

/* ── Paying people back ──────────────────────────────────────────────
   Settling up is a log of payments, not a checkbox. Someone can hand over
   half now and half next week, and several people can each be part-way
   through paying off the same bill.

   Older expenses carry the checkbox this replaced (`settled: { key: true }`).
   Rather than migrate them, they are read as "paid in full": the flag counts
   only while that person has no payments logged, so the moment a real payment
   is recorded it becomes the authority and the flag stops mattering. */
export const paymentsFor = (expense, key) =>
  (expense?.payments || []).filter(p => p && p.key === key);

export function amountPaid(expense, key, share) {
  const logged = paymentsFor(expense, key);
  if (logged.length) {
    return toDollars(logged.reduce((acc, p) => acc + toCents(p.amount), 0));
  }
  return expense?.settled?.[key] ? (Number(share) || 0) : 0;
}

/* What this person still owes. Floored at zero: overpaying someone's share
   is a thing that happens, and it should not turn into the payer owing them
   money on a bill they didn't pay for. */
export const remainingFor = (expense, key, share) => {
  const left = toCents(share) - toCents(amountPaid(expense, key, share));
  return left > 0 ? toDollars(left) : 0;
};

export const isSettled = (expense, key, share) => remainingFor(expense, key, share) === 0;

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
      const left = remainingFor(expense, key, amount);
      bump(key, 'owed', amount);
      // Derived from what's left rather than summed independently, so a part
      // payment always splits the share exactly and an overpayment can't make
      // the two add up to more than the share.
      bump(key, 'settledAmount', toDollars(toCents(amount) - toCents(left)));
      bump(key, 'outstanding', left);
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
  let collected = 0;
  let people = 0;
  let partly = 0;
  for (const [key, amount] of Object.entries(shares)) {
    if (key === payer) continue;
    people += 1;
    const left = remainingFor(expense, key, amount);
    owedTotal = toDollars(toCents(owedTotal) + toCents(amount));
    outstanding = toDollars(toCents(outstanding) + toCents(left));
    collected = toDollars(toCents(collected) + toCents(amount) - toCents(left));
    if (left > 0 && left < amount) partly += 1;
  }
  return {
    shares,
    people,
    owedTotal,
    outstanding,
    collected,
    partly,
    // An expense nobody else is on isn't "settled", it just isn't split yet.
    fullySettled: people > 0 && outstanding === 0,
    unsplit: people === 0,
  };
}
