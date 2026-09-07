import { describe, it, expect } from 'vitest';
import { matchGroupMembers, buildExpense, readErrors } from './splitwise';

const people = [
  { key: 'dan', name: 'Dan', email: 'dan@example.com' },
  { key: 'amy', name: 'Amy', email: 'Amy@Example.com' },
  { key: 'ben', name: 'Ben', email: null },
];
const groupMembers = [
  { id: 11, email: 'dan@example.com' },
  { id: 22, email: 'amy@example.com' },
  { id: 33, email: 'nobody@example.com' },
];

describe('matchGroupMembers', () => {
  it('lines people up by email, whatever the case', () => {
    const { matched } = matchGroupMembers(people, groupMembers);
    expect(matched.get('dan').splitwiseId).toBe(11);
    expect(matched.get('amy').splitwiseId).toBe(22);
  });

  it('names anyone it could not place rather than dropping them', () => {
    const { matched, unmatched } = matchGroupMembers(people, groupMembers);
    expect(matched.has('ben')).toBe(false);
    expect(unmatched.map(p => p.name)).toEqual(['Ben']);
  });

  it('does not match someone whose email is not in the group', () => {
    const { unmatched } = matchGroupMembers(
      [{ key: 'x', name: 'Xan', email: 'xan@example.com' }], groupMembers,
    );
    expect(unmatched.map(p => p.name)).toEqual(['Xan']);
  });

  it('matches the key holder by their Splitwise account, not their email', () => {
    // An organiser's own row often has no email — they never invited themselves.
    const host = [{ key: 'host', name: 'Host', email: null }];
    const { matched, unmatched } = matchGroupMembers(host, groupMembers, { key: 'host', splitwiseId: 33 });
    expect(matched.get('host').splitwiseId).toBe(33);
    expect(unmatched).toEqual([]);
  });

  it('does not conjure the key holder into a group they are not in', () => {
    const host = [{ key: 'host', name: 'Host', email: null }];
    const { unmatched } = matchGroupMembers(host, groupMembers, { key: 'host', splitwiseId: 999 });
    expect(unmatched.map(p => p.name)).toEqual(['Host']);
  });

  it('prefers the account over the email for the key holder', () => {
    const host = [{ key: 'host', name: 'Host', email: 'dan@example.com' }];
    const { matched } = matchGroupMembers(host, groupMembers, { key: 'host', splitwiseId: 33 });
    expect(matched.get('host').splitwiseId).toBe(33);
  });

  it('copes with an empty group or no people', () => {
    expect(matchGroupMembers([], groupMembers).matched.size).toBe(0);
    expect(matchGroupMembers(people, []).unmatched).toHaveLength(3);
    expect(matchGroupMembers(null, null).unmatched).toEqual([]);
  });
});

describe('buildExpense', () => {
  const { matched } = matchGroupMembers(people, groupMembers);
  const base = {
    description: 'Pizza',
    amount: 45,
    date: '2026-09-07',
    groupId: 777,
    shares: { dan: 22.5, amy: 22.5 },
    payerKey: 'dan',
    matched,
  };

  it('flattens the shares the way Splitwise wants them', () => {
    const body = buildExpense(base);
    expect(body).toMatchObject({
      cost: '45.00',
      description: 'Pizza',
      group_id: 777,
      currency_code: 'USD',
      users__0__user_id: 11,
      users__0__paid_share: '45.00',
      users__0__owed_share: '22.50',
      users__1__user_id: 22,
      users__1__paid_share: '0.00',
      users__1__owed_share: '22.50',
    });
  });

  it('pins the date to midday so a timezone cannot shunt it a day', () => {
    expect(buildExpense(base).date).toBe('2026-09-07T12:00:00Z');
    expect(buildExpense({ ...base, date: '' }).date).toBeUndefined();
  });

  it('has the payer down for the whole cost, and only their own share owed', () => {
    const body = buildExpense({ ...base, shares: { dan: 15, amy: 30 } });
    expect(body.users__0__paid_share).toBe('45.00');
    expect(body.users__0__owed_share).toBe('15.00');
    expect(body.users__1__paid_share).toBe('0.00');
  });

  it('leaves out anyone who is not in the group', () => {
    const body = buildExpense({ ...base, shares: { dan: 22.5, amy: 22.5, ben: 0 } });
    expect(body.users__2__user_id).toBeUndefined();
  });

  it('refuses a split that does not add up to the charge', () => {
    expect(() => buildExpense({ ...base, shares: { dan: 22.5, amy: 20 } }))
      .toThrow(/shares come to \$?42.5.*charge is/i);
  });

  it('refuses when the payer is not in the group', () => {
    expect(() => buildExpense({ ...base, payerKey: 'ben' }))
      .toThrow(/isn’t in that Splitwise group/);
  });

  it('refuses when the payer is not in on the charge', () => {
    const three = matchGroupMembers(
      [...people, { key: 'nob', name: 'Nob', email: 'nobody@example.com' }], groupMembers,
    ).matched;
    expect(() => buildExpense({ ...base, matched: three, payerKey: 'nob' }))
      .toThrow(/has to be in on the charge/);
  });

  it('refuses without a group, an amount, or anybody matched', () => {
    expect(() => buildExpense({ ...base, groupId: null })).toThrow(/Splitwise group/);
    expect(() => buildExpense({ ...base, amount: 0 })).toThrow(/no amount/);
    expect(() => buildExpense({ ...base, shares: { ben: 45 } })).toThrow(/Nobody on this charge/);
  });

  it('writes money as a decimal string, never a float', () => {
    const body = buildExpense({ ...base, amount: 10, shares: { dan: 3.34, amy: 6.66 } });
    expect(body.cost).toBe('10.00');
    expect(body.users__1__owed_share).toBe('6.66');
  });
});

describe('readErrors', () => {
  it('is empty when Splitwise accepted it', () => {
    expect(readErrors({ expenses: [{ id: 1 }], errors: {} })).toBe('');
    expect(readErrors({})).toBe('');
  });

  it('reads the shapes Splitwise sends errors back in', () => {
    expect(readErrors({ errors: { base: ['Invalid API request'] } })).toBe('Invalid API request');
    expect(readErrors({ errors: { cost: ['is invalid'] } })).toBe('cost: is invalid');
    expect(readErrors({ errors: ['nope'] })).toBe('nope');
    expect(readErrors({ errors: 'nope' })).toBe('nope');
  });

  it('joins several complaints', () => {
    expect(readErrors({ errors: { base: ['One'], cost: ['two'] } })).toBe('One · cost: two');
  });
});
