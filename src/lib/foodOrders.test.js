import { describe, it, expect } from 'vitest';
import {
  normalizeMenu, normalizeOrder, orderLabel, summarizeOrders, tallyText,
  offerableOptions, buildVoteStats, isYesMaybe, DEFAULT_PROMPT,
} from './foodOrders';

const menu = {
  enabled: true,
  prompt: 'What do you want?',
  options: [
    { id: 'burger', label: 'Cheeseburger' },
    { id: 'salad', label: 'Caesar salad' },
    { id: 'tacos', label: 'Fish tacos' },
  ],
};

// Everyone in these fixtures is a yes unless a test says otherwise — the
// summary only lists people who are eating, so without votes it lists nobody.
const yesFor = (...uids) => Object.fromEntries(uids.map(u => [u, { total: 1, yes: 1, maybe: 0, no: 0 }]));

describe('normalizeMenu', () => {
  it('keeps the options it is given', () => {
    const m = normalizeMenu(menu);
    expect(m.enabled).toBe(true);
    expect(m.options.map(o => o.label)).toEqual(['Cheeseburger', 'Caesar salad', 'Fish tacos']);
  });

  it('keeps a blank option, because that is one being typed into', () => {
    const m = normalizeMenu({ options: [{ id: 'a', label: '' }, { id: 'b', label: 'Pizza' }] });
    expect(m.options.map(o => o.id)).toEqual(['a', 'b']);
  });

  it('does not offer a blank option to a guest', () => {
    const m = normalizeMenu({ options: [{ id: 'a', label: '  ' }, { id: 'b', label: 'Pizza' }] });
    expect(offerableOptions(m).map(o => o.label)).toEqual(['Pizza']);
  });

  it('falls back to a usable prompt', () => {
    expect(normalizeMenu({}).prompt).toBe(DEFAULT_PROMPT);
    expect(normalizeMenu({ prompt: '   ' }).prompt).toBe(DEFAULT_PROMPT);
  });

  it('survives an event that has never had a menu', () => {
    const m = normalizeMenu(undefined);
    expect(m).toEqual({ enabled: false, prompt: DEFAULT_PROMPT, options: [] });
  });
});

describe('normalizeOrder', () => {
  it('reads a menu pick', () => {
    expect(normalizeOrder({ choice: 'burger', at: 'now' })).toEqual({ choice: 'burger', at: 'now' });
  });

  it('treats nothing chosen as not having ordered', () => {
    expect(normalizeOrder(null)).toBe(null);
    expect(normalizeOrder({})).toBe(null);
    expect(normalizeOrder({ choice: '' })).toBe(null);
  });

  it('drops a note and a write-in, which are no longer collected', () => {
    expect(normalizeOrder({ choice: 'burger', note: 'no onion', other: 'x' }))
      .toEqual({ choice: 'burger', at: null });
  });

  it('reads an old write-in order as not having ordered', () => {
    expect(normalizeOrder({ choice: '__other__', other: 'Poke bowl' })).toBe(null);
  });
});

describe('orderLabel', () => {
  const m = normalizeMenu(menu);

  it('names the option they picked', () => {
    expect(orderLabel({ choice: 'salad' }, m)).toBe('Caesar salad');
  });

  it('is empty once the option has been taken off the menu', () => {
    expect(orderLabel({ choice: 'gone' }, m)).toBe('');
  });

  it('is empty for someone who has not ordered', () => {
    expect(orderLabel(null, m)).toBe('');
  });
});

describe('buildVoteStats', () => {
  it('counts each vote by person', () => {
    const stats = buildVoteStats([
      { votes: { amy: { vote: 'yes' }, ben: { vote: 'no' } } },
      { votes: { amy: { vote: 'maybe' }, ben: { vote: 'no' } } },
    ]);
    expect(stats.amy).toEqual({ total: 2, yes: 1, maybe: 1, no: 0 });
    expect(stats.ben).toEqual({ total: 2, yes: 0, maybe: 0, no: 2 });
  });

  it('ignores closed, reference-only and empty votes', () => {
    const stats = buildVoteStats([
      { closed: true, votes: { amy: { vote: 'yes' } } },
      { noVote: true, votes: { ben: { vote: 'yes' } } },
      { votes: { cara: { vote: 'none' } } },
    ]);
    expect(stats).toEqual({});
  });
});

describe('isYesMaybe', () => {
  const members = { amy: { name: 'Amy' }, ben: { name: 'Ben' }, dan: { name: 'Dan', plusOneOf: 'amy' } };

  it('counts a yes and a maybe, not a no', () => {
    const stats = { amy: { yes: 1, maybe: 0 }, ben: { yes: 0, maybe: 1 }, cara: { yes: 0, maybe: 0, no: 2 } };
    expect(isYesMaybe('amy', members.amy, members, stats)).toBe(true);
    expect(isYesMaybe('ben', members.ben, members, stats)).toBe(true);
    expect(isYesMaybe('cara', { name: 'Cara' }, members, stats)).toBe(false);
  });

  it('leaves out someone who has not voted at all', () => {
    expect(isYesMaybe('amy', members.amy, members, {})).toBe(false);
  });

  it('lets a manual Going or Not going override the votes', () => {
    const stats = { amy: { yes: 1, maybe: 0 } };
    expect(isYesMaybe('amy', { ...members.amy, attendance: 'notgoing' }, members, stats)).toBe(false);
    expect(isYesMaybe('cara', { name: 'Cara', attendance: 'going' }, members, {})).toBe(true);
  });

  it('carries a linked +1 in on their partner’s vote, both ways round', () => {
    const stats = { amy: { yes: 1, maybe: 0 } };
    expect(isYesMaybe('dan', members.dan, members, stats)).toBe(true);
    // And the other way: Dan votes, Amy points at nobody but is pointed at.
    expect(isYesMaybe('amy', members.amy, members, { dan: { yes: 1, maybe: 0 } })).toBe(true);
  });

  it('leaves skipVote members out', () => {
    expect(isYesMaybe('amy', { ...members.amy, skipVote: true }, members, { amy: { yes: 1 } })).toBe(false);
  });
});

describe('summarizeOrders', () => {
  const base = (members) => ({ members, foodMenu: menu });

  it('lists everyone who is eating, ordered or not, by name', () => {
    const s = summarizeOrders(base({
      b: { name: 'Bea', foodOrder: { choice: 'burger' } },
      a: { name: 'Al' },
    }), undefined, yesFor('a', 'b'));
    expect(s.rows.map(r => r.name)).toEqual(['Al', 'Bea']);
    expect(s.orderedCount).toBe(1);
    expect(s.total).toBe(2);
    expect(s.waiting).toEqual(['Al']);
  });

  it('leaves out anyone who is not a yes or a maybe', () => {
    const s = summarizeOrders(base({
      a: { name: 'Al', foodOrder: { choice: 'burger' } },
      n: { name: 'Ned', foodOrder: { choice: 'salad' } },
    }), undefined, yesFor('a'));
    expect(s.rows.map(r => r.name)).toEqual(['Al']);
    expect(tallyText(s)).toBe('1 × Cheeseburger');
  });

  it('totals the menu picks', () => {
    const s = summarizeOrders(base({
      a: { name: 'Al', foodOrder: { choice: 'burger' } },
      b: { name: 'Bea', foodOrder: { choice: 'burger' } },
      c: { name: 'Cy', foodOrder: { choice: 'salad' } },
    }), undefined, yesFor('a', 'b', 'c'));
    expect(s.counts).toEqual([
      { id: 'burger', label: 'Cheeseburger', count: 2 },
      { id: 'salad', label: 'Caesar salad', count: 1 },
    ]);
  });

  it('lets a plus-one inherit the order of whoever they came with', () => {
    const s = summarizeOrders(base({
      a: { name: 'Al', foodOrder: { choice: 'burger' } },
      d: { name: 'Dee', plusOneOf: 'a' },
    }), undefined, yesFor('a'));
    const dee = s.rows.find(r => r.name === 'Dee');
    expect(dee.inherited).toBe(true);
    expect(dee.label).toBe('Cheeseburger');
    expect(s.counts[0].count).toBe(2);
  });

  it('lets a plus-one order for themselves instead', () => {
    const s = summarizeOrders(base({
      a: { name: 'Al', foodOrder: { choice: 'burger' } },
      d: { name: 'Dee', plusOneOf: 'a', foodOrder: { choice: 'tacos' } },
    }), undefined, yesFor('a'));
    const dee = s.rows.find(r => r.name === 'Dee');
    expect(dee.inherited).toBe(false);
    expect(dee.label).toBe('Fish tacos');
  });

  it('leaves skipVote members out entirely', () => {
    const s = summarizeOrders(base({
      a: { name: 'Al', foodOrder: { choice: 'burger' } },
      s: { name: 'Sam', skipVote: true, foodOrder: { choice: 'salad' } },
    }), undefined, yesFor('a', 's'));
    expect(s.rows.map(r => r.name)).toEqual(['Al']);
  });

  it('ignores an order left over from the old write-in', () => {
    const s = summarizeOrders(base({
      a: { name: 'Al', foodOrder: { choice: '__other__', other: 'Poke bowl' } },
    }), undefined, yesFor('a'));
    expect(s.orderedCount).toBe(0);
    expect(s.waiting).toEqual(['Al']);
  });

  it('handles an event with no orders at all', () => {
    const s = summarizeOrders({ members: {}, foodMenu: menu }, undefined, {});
    expect(s.rows).toEqual([]);
    expect(tallyText(s)).toBe('');
  });
});

describe('tallyText', () => {
  it('reads out as an order you could hand over', () => {
    const s = summarizeOrders({
      members: {
        a: { name: 'Al', foodOrder: { choice: 'burger' } },
        b: { name: 'Bea', foodOrder: { choice: 'burger' } },
        c: { name: 'Cy', foodOrder: { choice: 'salad' } },
      },
      foodMenu: menu,
    }, undefined, yesFor('a', 'b', 'c'));
    expect(tallyText(s)).toBe('2 × Cheeseburger, 1 × Caesar salad');
  });
});
