import { describe, it, expect } from 'vitest';
import {
  evenShares, sumShares, resolveShares, unassigned, balances, expenseStatus,
  amountPaid, remainingFor, isSettled, paymentsFor, toCents, toDollars,
  newExpense, expenseDraftError, memberListFor, expenseMatrix, personStatement,
  remainderKeyFor,
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

describe('newExpense', () => {
  const at = '2026-09-06T12:00:00.000Z';

  it('writes the same document shape the bank feed does', () => {
    const e = newExpense({ description: 'Boat fuel', amount: '120.50', paidBy: 'dan', eventId: 'ev1', participants: ['dan', 'amy'], now: at });
    expect(e).toMatchObject({
      source: 'manual', externalId: null, description: 'Boat fuel', amount: 120.5,
      eventId: 'ev1', paidBy: 'dan', splitMode: 'even', shares: {}, settled: {},
      archived: false, createdAt: at, updatedAt: at,
    });
    expect(e.participants).toEqual(['dan', 'amy']);
  });

  it('always has a date, because the list is ordered by one', () => {
    expect(newExpense({ now: at }).date).toBe('2026-09-06');
    expect(newExpense({ date: '2026-07-04', now: at }).date).toBe('2026-07-04');
  });

  it('puts whoever paid on the charge even if they were not ticked', () => {
    expect(newExpense({ paidBy: 'dan', participants: ['amy'] }).participants).toEqual(['dan', 'amy']);
  });

  it('does not list anyone twice', () => {
    expect(newExpense({ paidBy: 'dan', participants: ['dan', 'amy', 'dan'] }).participants).toEqual(['dan', 'amy']);
  });

  it('rounds the amount to whole cents', () => {
    expect(newExpense({ amount: 10.005 }).amount).toBe(10.01);
    expect(newExpense({ amount: '  42 ' }).amount).toBe(42);
  });

  it('falls back to a description rather than saving a blank one', () => {
    expect(newExpense({ description: '   ' }).description).toBe('Untitled charge');
  });
});

describe('expenseDraftError', () => {
  it('passes a filled-in draft', () => {
    expect(expenseDraftError({ description: 'Boat fuel', amount: '120.50' })).toBe('');
  });

  it('needs a description', () => {
    expect(expenseDraftError({ description: '  ', amount: '10' })).toMatch(/description/i);
  });

  it('needs an amount above zero', () => {
    expect(expenseDraftError({ description: 'x', amount: '' })).toMatch(/above zero/i);
    expect(expenseDraftError({ description: 'x', amount: '0' })).toMatch(/above zero/i);
    expect(expenseDraftError({ description: 'x', amount: '-5' })).toMatch(/above zero/i);
    expect(expenseDraftError({ description: 'x', amount: 'abc' })).toMatch(/above zero/i);
  });

  it('catches an amount with an obvious extra digit', () => {
    expect(expenseDraftError({ description: 'x', amount: '99999999' })).toMatch(/looks wrong/i);
  });
});

describe('memberListFor', () => {
  it('reads names off an event, sorted', () => {
    const list = memberListFor({ members: { b: { name: 'Zoe' }, a: { name: 'Al', email: 'al@x.com', venmo: 'al' } } });
    expect(list.map(m => m.name)).toEqual(['Al', 'Zoe']);
    expect(list[0]).toEqual({ key: 'a', name: 'Al', email: 'al@x.com', venmo: 'al' });
    expect(list[1]).toMatchObject({ key: 'b', email: null, venmo: null });
  });

  it('falls back to the email, then the key', () => {
    const list = memberListFor({ members: { a: { email: 'al@x.com' }, zz: {} } });
    expect(list.map(m => m.name)).toEqual(['al@x.com', 'zz']);
  });

  it('handles no event at all', () => {
    expect(memberListFor(null)).toEqual([]);
  });
});

describe('expenseMatrix', () => {
  const people = [{ key: 'dan', name: 'Dan' }, { key: 'amy', name: 'Amy' }, { key: 'ben', name: 'Ben' }];
  const pizza = { id: 'p', description: 'Pizza', date: '2026-09-06', amount: 45, paidBy: 'dan', splitMode: 'even', participants: ['dan', 'amy', 'ben'] };
  const beer = { id: 'b', description: 'Beer', date: '2026-09-07', amount: 20, paidBy: 'amy', splitMode: 'even', participants: ['dan', 'amy'] };
  const build = (exp = [pizza, beer], who) => expenseMatrix(exp, people, who || (e => e.participants));

  it('puts a column on every charge and a row on every person', () => {
    const m = build();
    expect(m.columns.map(c => c.description)).toEqual(['Pizza', 'Beer']);
    expect(m.rows.map(r => r.name)).toEqual(['Dan', 'Amy', 'Ben']);
  });

  it('leaves a blank cell where somebody is not in on a charge', () => {
    const m = build();
    const ben = m.rows.find(r => r.key === 'ben');
    expect(ben.cells.map(c => c.on)).toEqual([true, false]);
    expect(ben.total).toBe(15);
  });

  it('marks the payer rather than billing them for their own charge', () => {
    const m = build();
    const dan = m.rows.find(r => r.key === 'dan');
    expect(dan.cells[0]).toMatchObject({ isPayer: true, share: 15, remaining: 0 });
    // Still $10 of Amy's beer to pay back, and none of his own pizza.
    expect(dan.outstanding).toBe(10);
  });

  it('counts what someone still owes across the whole trip', () => {
    const m = build();
    const amy = m.rows.find(r => r.key === 'amy');
    expect(amy.total).toBe(25);        // $15 pizza + $10 beer
    expect(amy.outstanding).toBe(15);  // owes the pizza, paid the beer herself
  });

  it('drops a share once it has been paid', () => {
    const paid = { ...pizza, payments: [{ id: '1', key: 'amy', amount: 15 }] };
    const m = build([paid]);
    const amy = m.rows.find(r => r.key === 'amy');
    expect(amy.cells[0]).toMatchObject({ share: 15, remaining: 0, paid: true });
    expect(amy.outstanding).toBe(0);
  });

  it('foots each column with what was divided up, not just the charge', () => {
    const lopsided = { ...pizza, splitMode: 'custom', shares: { dan: 15, amy: 10, ben: 10 } };
    const m = build([lopsided]);
    expect(m.footers[0]).toMatchObject({ amount: 45, split: 35, outstanding: 20 });
  });

  it('narrows a split to whoever is passed in, leaving the stored list alone', () => {
    const m = build([pizza], () => ['dan', 'amy']);
    expect(m.rows.find(r => r.key === 'ben').cells[0].on).toBe(false);
    expect(m.rows.find(r => r.key === 'amy').cells[0].share).toBe(22.5);
    expect(pizza.participants).toEqual(['dan', 'amy', 'ben']);
  });

  it('totals the trip', () => {
    const m = build();
    expect(m.grandTotal).toBe(65);
    expect(m.grandOutstanding).toBe(40); // pizza: Amy 15 + Ben 15; beer: Dan 10
  });

  it('handles a trip with nothing on it', () => {
    const m = expenseMatrix([], people, e => e.participants);
    expect(m.columns).toEqual([]);
    expect(m.rows.every(r => r.total === 0 && r.cells.length === 0)).toBe(true);
    expect(m.grandTotal).toBe(0);
  });
});

describe('personStatement', () => {
  const pizza = { id: 'p', description: 'Pizza', date: '2026-09-06', amount: 45, paidBy: 'dan', splitMode: 'even', participants: ['dan', 'amy', 'ben'] };
  const beer = { id: 'b', description: 'Beer', date: '2026-09-07', amount: 20, paidBy: 'amy', splitMode: 'even', participants: ['dan', 'amy'] };
  const cab = { id: 'c', description: 'Cab', date: '2026-09-07', amount: 30, paidBy: 'dan', splitMode: 'even', participants: ['dan', 'amy'] };
  const of = (key, exp = [pizza, beer, cab], who) => personStatement(exp, key, who || (e => e.participants));

  it('lists only the charges that person is in on', () => {
    expect(of('ben').lines.map(l => l.description)).toEqual(['Pizza']);
    expect(of('amy').lines.map(l => l.description)).toEqual(['Pizza', 'Beer', 'Cab']);
  });

  it('adds up what they still owe, ignoring their share of what they paid', () => {
    const amy = of('amy');
    expect(amy.share).toBe(40);        // 15 pizza + 10 beer + 15 cab
    expect(amy.outstanding).toBe(30);  // the beer is her own money
  });

  it('says who the money is owed to, not just how much', () => {
    expect(of('amy').owedTo).toEqual([{ key: 'dan', amount: 30, count: 2 }]);
    // Dan fronted two of the three, so all he owes is his share of the beer.
    expect(of('dan').owedTo).toEqual([{ key: 'amy', amount: 10, count: 1 }]);
  });

  it('splits what is left between several people who fronted things', () => {
    const cash = { id: 'x', description: 'Cash', amount: 12, paidBy: 'ben', splitMode: 'even', participants: ['ben', 'amy'] };
    expect(of('amy', [pizza, cash]).owedTo).toEqual([
      { key: 'dan', amount: 15, count: 1 },
      { key: 'ben', amount: 6, count: 1 },
    ]);
  });

  it('keeps a charge they paid for on the statement, marked as theirs', () => {
    const dan = of('dan');
    expect(dan.lines.find(l => l.id === 'p')).toMatchObject({ isPayer: true, share: 15, remaining: 0 });
    expect(dan.fronted).toBe(75);      // the whole pizza and the whole cab
    expect(dan.share).toBe(40);        // his own thirds and halves of them
    expect(dan.outstanding).toBe(10);  // only the beer Amy bought
  });

  it('counts a part payment against what is left', () => {
    const part = { ...pizza, payments: [{ id: '1', key: 'amy', amount: 5 }] };
    const amy = of('amy', [part]);
    expect(amy.lines[0]).toMatchObject({ share: 15, paid: 5, remaining: 10, settled: false });
    expect(amy.paid).toBe(5);
    expect(amy.outstanding).toBe(10);
  });

  it('marks a line settled once it is paid off, and drops it from owedTo', () => {
    const done = { ...pizza, payments: [{ id: '1', key: 'ben', amount: 15 }] };
    const ben = of('ben', [done]);
    expect(ben.lines[0]).toMatchObject({ remaining: 0, settled: true });
    expect(ben.outstanding).toBe(0);
    expect(ben.owedTo).toEqual([]);
  });

  it('narrows a split to whoever is passed in, as the trip tab does', () => {
    const amy = of('amy', [pizza], () => ['dan', 'amy']);
    expect(amy.lines[0].share).toBe(22.5);
    expect(amy.outstanding).toBe(22.5);
  });

  it('gives somebody in on nothing an empty statement rather than nothing', () => {
    const nobody = of('zoe');
    expect(nobody).toMatchObject({ key: 'zoe', lines: [], share: 0, outstanding: 0, owedTo: [] });
  });
});

describe('the odd cents', () => {
  // The bug this rule exists for: eleven people in on the same four charges,
  // shown eleven slightly different totals because the participant list is
  // sorted by name and the leftover cent always went to the front of it.
  const PEOPLE = ['amanda', 'christina', 'dan', 'hannah', 'jake', 'jenna',
    'joanne', 'kyle', 'pheobe', 'sohee', 'sungchea', 'tomasz'];

  it('gives every leftover cent to the owner of the charge', () => {
    const e = { amount: 175, splitMode: 'even', ownerUid: 'dan' };
    const shares = resolveShares(e, PEOPLE);
    expect(shares.dan).toBe(14.62);
    // 175 / 12 is 14.5833…, so eleven people pay 14.58 and Dan takes the 4 over.
    for (const k of PEOPLE.filter((p) => p !== 'dan')) expect(shares[k]).toBe(14.58);
    expect(sumShares(shares)).toBe(175);
  });

  it('leaves everybody else on exactly the same number', () => {
    const charges = [175, 45, 111.81, 196.61];
    const totals = {};
    for (const amount of charges) {
      const shares = resolveShares({ amount, splitMode: 'even', ownerUid: 'dan' }, PEOPLE);
      expect(sumShares(shares)).toBe(amount);
      for (const k of PEOPLE) totals[k] = toDollars(toCents(totals[k] || 0) + toCents(shares[k]));
    }
    const others = PEOPLE.filter((p) => p !== 'dan').map((k) => totals[k]);
    expect(new Set(others).size).toBe(1);   // one number, not four
    expect(others[0]).toBe(44.02);
    expect(totals.dan).toBe(44.20);
  });

  it('finds the owner however the member is keyed', () => {
    const by = (expense) => resolveShares({ amount: 10, splitMode: 'even', ...expense }, ['a', 'b', 'c']);
    // 10 / 3 leaves one cent over, so whoever takes it is the one on 3.34.
    expect(by({ ownerUid: 'b' }).b).toBe(3.34);
    expect(by({ ownerEmail: 'B@x.com' }).b).toBe(3.33);        // no key called that
    expect(remainderKeyFor({ ownerUid: 'b' }, ['a', 'b'])).toBe('b');
    expect(remainderKeyFor({ ownerEmail: 'Me@X.com' }, ['a', 'me@x.com'])).toBe('me@x.com');
    expect(remainderKeyFor({ ownerEmail: 'me@x.com' }, ['a', 'me_x_com'])).toBe('me_x_com');
  });

  it('falls back to spreading it when the owner is not in on the charge', () => {
    const shares = resolveShares({ amount: 10, splitMode: 'even', ownerUid: 'zoe' }, ['a', 'b', 'c']);
    expect(shares).toEqual({ a: 3.34, b: 3.33, c: 3.33 });
    expect(sumShares(shares)).toBe(10);
  });

  it('is a no-op on a charge that divides evenly anyway', () => {
    expect(resolveShares({ amount: 30, splitMode: 'even', ownerUid: 'a' }, ['a', 'b', 'c']))
      .toEqual({ a: 10, b: 10, c: 10 });
  });

  it('never loses or invents a cent, whoever absorbs it', () => {
    for (const amount of [0.01, 0.07, 1.11, 33.33, 175, 196.61, 421.37]) {
      for (const n of [1, 2, 3, 7, 11, 12]) {
        const keys = Array.from({ length: n }, (_, i) => `p${i}`);
        const shares = resolveShares({ amount, splitMode: 'even', ownerUid: 'p0' }, keys);
        expect(sumShares(shares)).toBe(amount);
      }
    }
  });

  it('leaves a custom split alone — those cents were typed, not divided', () => {
    const e = { amount: 100, splitMode: 'custom', shares: { a: 60, b: 40 }, ownerUid: 'a' };
    expect(resolveShares(e, ['a', 'b'])).toEqual({ a: 60, b: 40 });
  });
});
