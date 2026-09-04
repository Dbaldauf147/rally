import { describe, it, expect } from 'vitest';
import {
  normalizeMenu, normalizeOrder, orderLabel, summarizeOrders, tallyText, offerableOptions, OTHER, DEFAULT_PROMPT,
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
    expect(normalizeOrder({ choice: 'burger', note: 'no onion' }))
      .toMatchObject({ choice: 'burger', note: 'no onion' });
  });

  it('reads a written-in order', () => {
    expect(normalizeOrder({ choice: OTHER, other: 'Poke bowl' }))
      .toMatchObject({ choice: OTHER, other: 'Poke bowl' });
  });

  it('treats nothing chosen as not having ordered', () => {
    expect(normalizeOrder(null)).toBe(null);
    expect(normalizeOrder({})).toBe(null);
    expect(normalizeOrder({ choice: '', other: '' })).toBe(null);
  });

  it('treats an empty "something else" as not having ordered', () => {
    expect(normalizeOrder({ choice: OTHER, other: '   ' })).toBe(null);
  });

  it('does not count a note on its own as an order', () => {
    expect(normalizeOrder({ note: 'allergic to shellfish' })).toBe(null);
  });
});

describe('orderLabel', () => {
  const m = normalizeMenu(menu);

  it('names the option they picked', () => {
    expect(orderLabel({ choice: 'burger' }, m)).toBe('Cheeseburger');
  });

  it('uses their own words when they wrote their own', () => {
    expect(orderLabel({ choice: OTHER, other: 'Poke bowl' }, m)).toBe('Poke bowl');
  });

  it('says so when the option has since been taken off the menu', () => {
    expect(orderLabel({ choice: 'gone' }, m)).toBe('No longer on the menu');
  });

  it('is empty for someone who has not ordered', () => {
    expect(orderLabel(null, m)).toBe('');
  });
});

describe('summarizeOrders', () => {
  const event = (members) => ({ foodMenu: menu, members });

  it('lists everyone, ordered or not, by name', () => {
    const s = summarizeOrders(event({
      u2: { name: 'Ben', foodOrder: { choice: 'salad' } },
      u1: { name: 'Ann', foodOrder: { choice: 'burger', note: 'no onion' } },
      u3: { name: 'Cal' },
    }));
    expect(s.rows.map(r => r.name)).toEqual(['Ann', 'Ben', 'Cal']);
    expect(s.orderedCount).toBe(2);
    expect(s.total).toBe(3);
    expect(s.waiting).toEqual(['Cal']);
  });

  it('carries the note through to the table', () => {
    const s = summarizeOrders(event({ u1: { name: 'Ann', foodOrder: { choice: 'burger', note: 'no onion' } } }));
    expect(s.rows[0]).toMatchObject({ label: 'Cheeseburger', note: 'no onion' });
  });

  it('totals the menu picks', () => {
    const s = summarizeOrders(event({
      u1: { name: 'Ann', foodOrder: { choice: 'burger' } },
      u2: { name: 'Ben', foodOrder: { choice: 'burger' } },
      u3: { name: 'Cal', foodOrder: { choice: 'salad' } },
    }));
    expect(s.counts).toEqual([
      { id: 'burger', label: 'Cheeseburger', count: 2 },
      { id: 'salad', label: 'Caesar salad', count: 1 },
    ]);
  });

  it('lists written-in orders apart from the totals', () => {
    const s = summarizeOrders(event({
      u1: { name: 'Ann', foodOrder: { choice: 'burger' } },
      u2: { name: 'Ben', foodOrder: { choice: OTHER, other: 'Poke bowl' } },
    }));
    expect(s.counts).toEqual([{ id: 'burger', label: 'Cheeseburger', count: 1 }]);
    expect(s.others).toEqual(['Poke bowl']);
  });

  it('lets a plus-one inherit the order of whoever they came with', () => {
    const s = summarizeOrders(event({
      u1: { name: 'Ann', foodOrder: { choice: 'burger' } },
      u2: { name: 'Ann +1', plusOneOf: 'u1' },
    }));
    expect(s.waiting).toEqual([]);
    expect(s.orderedCount).toBe(2);
    expect(s.rows.find(r => r.name === 'Ann +1').inherited).toBe(true);
  });

  it('lets a plus-one order for themselves instead', () => {
    const s = summarizeOrders(event({
      u1: { name: 'Ann', foodOrder: { choice: 'burger' } },
      u2: { name: 'Ann +1', plusOneOf: 'u1', foodOrder: { choice: 'salad' } },
    }));
    const plus = s.rows.find(r => r.name === 'Ann +1');
    expect(plus.label).toBe('Caesar salad');
    expect(plus.inherited).toBe(false);
  });

  it('leaves skipVote members out entirely', () => {
    const s = summarizeOrders(event({
      u1: { name: 'Ann', foodOrder: { choice: 'burger' } },
      u2: { name: 'Baby', skipVote: true },
    }));
    expect(s.total).toBe(1);
    expect(s.waiting).toEqual([]);
  });

  it('handles an event with no orders at all', () => {
    const s = summarizeOrders(event({ u1: { name: 'Ann' } }));
    expect(s.orderedCount).toBe(0);
    expect(s.counts).toEqual([]);
    expect(tallyText(s)).toBe('');
  });
});

describe('tallyText', () => {
  it('reads out as an order you could hand over', () => {
    const s = summarizeOrders({
      foodMenu: menu,
      members: {
        u1: { name: 'Ann', foodOrder: { choice: 'burger' } },
        u2: { name: 'Ben', foodOrder: { choice: 'burger' } },
        u3: { name: 'Cal', foodOrder: { choice: 'salad' } },
        u4: { name: 'Dee', foodOrder: { choice: OTHER, other: 'Poke bowl' } },
      },
    });
    expect(tallyText(s)).toBe('2 × Cheeseburger, 1 × Caesar salad, 1 × Poke bowl');
  });
});
