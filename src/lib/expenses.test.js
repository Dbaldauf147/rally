import { describe, it, expect } from 'vitest';
import {
  evenShares, sumShares, resolveShares, unassigned, balances, expenseStatus,
  amountPaid, remainingFor, isSettled, paymentsFor, toCents, toDollars,
} from './expenses';

const expense = (over = {}) => ({
  id: 'e1', amount: 90, splitMode: 'even', paidBy: 'me',
  shares: {}, participants: ['me', 'a', 'b'], settled: {}, payments: [], ...over,
});

describe('evenShares', () => {
  it('divides evenly when it divides evenly', () => {
    expect(evenShares(100, ['a', 'b', 'c', 'd'])).toEqual({ a: 25, b: 25, c: 25, d: 25 });
  });

  // The whole reason this module works in cents: in floats these shares are
  // 3.3333… and add up to less than the charge, leaving a debt nobody can
  // ever clear.
  it('spreads the remainder so shares add up to exactly the charge', () => {
    const shares = evenShares(10, ['a', 'b', 'c']);
    expect(shares).toEqual({ a: 3.34, b: 3.33, c: 3.33 });
    expect(sumShares(shares)).toBe(10);
  });

  it('handles amounts smaller than one cent per person', () => {
    const shares = evenShares(0.05, ['a', 'b', 'c', 'd', 'e', 'f']);
    expect(sumShares(shares)).toBe(0.05);
    expect(shares.f).toBe(0);
  });

  it('never loses a cent, whatever the amount', () => {
    for (const amount of [0.01, 0.07, 1.11, 33.33, 421.37, 999.99]) {
      for (const n of [1, 2, 3, 4, 5, 7, 11]) {
        const keys = Array.from({ length: n }, (_, i) => `p${i}`);
        expect(sumShares(evenShares(amount, keys))).toBe(amount);
      }
    }
  });

  it('returns nothing when nobody is participating', () => {
    expect(evenShares(50, [])).toEqual({});
  });
});

describe('resolveShares', () => {
  it('recomputes an even split when the participants change', () => {
    expect(resolveShares(expense(), ['me', 'a'])).toEqual({ me: 45, a: 45 });
  });

  it('keeps custom amounts, dropping anyone no longer in on it', () => {
    const e = expense({ splitMode: 'custom', shares: { me: 50, a: 40 } });
    expect(resolveShares(e, ['me', 'a'])).toEqual({ me: 50, a: 40 });
    expect(resolveShares(e, ['me'])).toEqual({ me: 50 });
  });

  it('reports a custom split that does not add up', () => {
    const e = expense({ amount: 100, splitMode: 'custom', shares: { me: 50, a: 40 } });
    expect(unassigned(e, resolveShares(e, ['me', 'a']))).toBe(10);
  });

  it('reports an over-assigned split as negative', () => {
    const e = expense({ amount: 100, splitMode: 'custom', shares: { me: 70, a: 40 } });
    expect(unassigned(e, resolveShares(e, ['me', 'a']))).toBe(-10);
  });
});

describe('payments', () => {
  it('treats an old settled flag as paid in full', () => {
    const e = expense({ settled: { a: true } });
    expect(amountPaid(e, 'a', 30)).toBe(30);
    expect(remainingFor(e, 'a', 30)).toBe(0);
    expect(isSettled(e, 'a', 30)).toBe(true);
  });

  it('lets a payment be partial', () => {
    const e = expense({ payments: [{ id: 'p1', key: 'a', amount: 10 }] });
    expect(amountPaid(e, 'a', 30)).toBe(10);
    expect(remainingFor(e, 'a', 30)).toBe(20);
    expect(isSettled(e, 'a', 30)).toBe(false);
  });

  it('adds several payments from the same person', () => {
    const e = expense({ payments: [
      { id: 'p1', key: 'a', amount: 10 },
      { id: 'p2', key: 'a', amount: 12.5 },
      { id: 'p3', key: 'b', amount: 30 },
    ] });
    expect(amountPaid(e, 'a', 30)).toBe(22.5);
    expect(remainingFor(e, 'a', 30)).toBe(7.5);
    expect(paymentsFor(e, 'a')).toHaveLength(2);
    expect(isSettled(e, 'b', 30)).toBe(true);
  });

  // Once a real payment exists it is the authority — otherwise a stale flag
  // and a payment log could disagree about the same person.
  it('lets payments override a legacy settled flag', () => {
    const e = expense({ settled: { a: true }, payments: [{ id: 'p1', key: 'a', amount: 5 }] });
    expect(amountPaid(e, 'a', 30)).toBe(5);
    expect(remainingFor(e, 'a', 30)).toBe(25);
  });

  it('never turns an overpayment into money owed back', () => {
    const e = expense({ payments: [{ id: 'p1', key: 'a', amount: 100 }] });
    expect(remainingFor(e, 'a', 30)).toBe(0);
  });
});

describe('expenseStatus', () => {
  it("excludes the payer's own share from what is owed", () => {
    const s = expenseStatus(expense(), ['me', 'a', 'b']);
    expect(s.shares).toEqual({ me: 30, a: 30, b: 30 });
    expect(s.people).toBe(2);
    expect(s.owedTotal).toBe(60);
    expect(s.outstanding).toBe(60);
  });

  it('counts part payments toward what has come in', () => {
    const e = expense({ payments: [{ id: 'p1', key: 'a', amount: 10 }] });
    const s = expenseStatus(e, ['me', 'a', 'b']);
    expect(s.outstanding).toBe(50);
    expect(s.collected).toBe(10);
    expect(s.partly).toBe(1);
    expect(s.fullySettled).toBe(false);
  });

  it('is fully settled once everyone has paid their share', () => {
    const e = expense({ payments: [
      { id: 'p1', key: 'a', amount: 30 },
      { id: 'p2', key: 'b', amount: 30 },
    ] });
    const s = expenseStatus(e, ['me', 'a', 'b']);
    expect(s.outstanding).toBe(0);
    expect(s.fullySettled).toBe(true);
  });

  it('is not "settled" when nobody else is on it', () => {
    const s = expenseStatus(expense({ participants: ['me'] }), ['me']);
    expect(s.unsplit).toBe(true);
    expect(s.fullySettled).toBe(false);
  });
});

describe('balances', () => {
  it('adds up what each person owes across expenses', () => {
    const rows = balances([
      expense({ id: '1', amount: 90, participants: ['me', 'a', 'b'] }),
      expense({ id: '2', amount: 60, splitMode: 'custom', shares: { me: 20, a: 40 }, participants: ['me', 'a'],
        payments: [{ id: 'p1', key: 'a', amount: 40 }] }),
    ], e => e.participants);

    const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
    expect(byKey.a.owed).toBe(70);          // 30 + 40
    expect(byKey.a.settledAmount).toBe(40);
    expect(byKey.a.outstanding).toBe(30);
    expect(byKey.b.outstanding).toBe(30);
    expect(byKey.me).toBeUndefined();       // the payer is never owed their own share
  });

  it('keeps paid and outstanding adding up to the share, even on an overpayment', () => {
    const rows = balances([
      expense({ amount: 90, payments: [{ id: 'p1', key: 'a', amount: 999 }] }),
    ], e => e.participants);
    const a = rows.find(r => r.key === 'a');
    expect(a.settledAmount + a.outstanding).toBe(a.owed);
  });

  it('sorts the people who owe most to the top', () => {
    const rows = balances([
      expense({ amount: 90, splitMode: 'custom', shares: { me: 10, a: 20, b: 60 }, participants: ['me', 'a', 'b'] }),
    ], e => e.participants);
    expect(rows.map(r => r.key)).toEqual(['b', 'a']);
  });
});

describe('cent conversion', () => {
  it('survives the classic float traps', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toDollars(toCents(19.99))).toBe(19.99);
    expect(toCents(1.005)).toBe(101);
  });
});
