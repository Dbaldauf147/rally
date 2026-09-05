import { describe, it, expect } from 'vitest';
import {
  normalizeMenu, normalizeOrder, orderLabel, summarizeOrders, tallyText,
  offerableOptions, buildVoteStats, isYesMaybe, matchOption, DEFAULT_PROMPT,
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
    expect(normalizeOrder({ choice: 'burger', at: 'now' })).toEqual({ choice: 'burger', text: '', at: 'now' });
  });

  it('reads a meal typed out in full', () => {
    expect(normalizeOrder({ text: '  Grilled salmon ' })).toEqual({ choice: '', text: 'Grilled salmon', at: null });
  });

  it('treats nothing chosen as not having ordered', () => {
    expect(normalizeOrder(null)).toBe(null);
    expect(normalizeOrder({})).toBe(null);
    expect(normalizeOrder({ choice: '', text: '  ' })).toBe(null);
  });

  it('drops a note, which is no longer collected', () => {
    expect(normalizeOrder({ choice: 'burger', note: 'no onion' }))
      .toEqual({ choice: 'burger', text: '', at: null });
  });

  it('carries an old write-in over as a typed meal', () => {
    expect(normalizeOrder({ choice: '__other__', other: 'Poke bowl' }))
      .toEqual({ choice: '', text: 'Poke bowl', at: null });
  });

  it('is not an order when the old write-in had no words with it', () => {
    expect(normalizeOrder({ choice: '__other__', other: '' })).toBe(null);
  });
});

describe('matchOption', () => {
  const m = normalizeMenu(menu);

  it('resolves a typed name to the option it names, whatever the case', () => {
    expect(matchOption('cheeseburger', m).id).toBe('burger');
    expect(matchOption('  Caesar Salad ', m).id).toBe('salad');
  });

  it('leaves anything else alone', () => {
    expect(matchOption('Grilled salmon', m)).toBe(null);
    expect(matchOption('', m)).toBe(null);
  });
});

describe('orderLabel', () => {
  const m = normalizeMenu(menu);

  it('names the option they picked', () => {
    expect(orderLabel({ choice: 'salad' }, m)).toBe('Caesar salad');
  });

  it('reads out a meal typed in full', () => {
    expect(orderLabel({ choice: '', text: 'Grilled salmon' }, m)).toBe('Grilled salmon');
  });

  it('falls back to the words when the option has been taken off the menu', () => {
    expect(orderLabel({ choice: 'gone', text: 'Grilled salmon' }, m)).toBe('Grilled salmon');
    expect(orderLabel({ choice: 'gone', text: '' }, m)).toBe('');
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

  it('counts typed meals after the menu ones, grouped by what was typed', () => {
    const s = summarizeOrders(base({
      a: { name: 'Al', foodOrder: { choice: 'burger' } },
      b: { name: 'Bea', foodOrder: { text: 'Grilled salmon' } },
      c: { name: 'Cy', foodOrder: { text: 'grilled salmon' } },
    }), undefined, yesFor('a', 'b', 'c'));
    expect(s.counts).toEqual([
      { id: 'burger', label: 'Cheeseburger', count: 1 },
      { id: 'typed:grilled salmon', label: 'Grilled salmon', count: 2, typed: true },
    ]);
    expect(tallyText(s)).toBe('1 × Cheeseburger, 2 × Grilled salmon');
  });

  it('still reads an order left over from the old write-in', () => {
    const s = summarizeOrders(base({
      a: { name: 'Al', foodOrder: { choice: '__other__', other: 'Poke bowl' } },
    }), undefined, yesFor('a'));
    expect(s.orderedCount).toBe(1);
    expect(s.rows[0].label).toBe('Poke bowl');
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
