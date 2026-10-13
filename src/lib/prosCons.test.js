import { describe, it, expect } from 'vitest';
import {
  PRO, CON, SCALE, ratingLabel, normalizeProsCons, addDecision, updateDecision, removeDecision,
  addItem, updateItem, removeItem, tally,
} from './prosCons';

const empty = () => normalizeProsCons(null);
const withDecision = () => addDecision(empty(), { id: 'd1', title: 'Move to Denver?', now: 1 });

describe('the scale', () => {
  it('speaks in words, strongest first, good on one side and bad on the other', () => {
    expect(SCALE[CON].map((s) => s.label)).toEqual([
      'Will ruin this', 'Will make this worse', 'Will make this a little worse',
    ]);
    expect(SCALE[PRO].every((s) => s.value > 0)).toBe(true);
    expect(SCALE[CON].every((s) => s.value < 0)).toBe(true);
    expect(ratingLabel(-1)).toBe('Will make this a little worse');
    expect(ratingLabel(null)).toBe('Not rated yet');
  });
});

describe('normalizeProsCons', () => {
  it('starts empty', () => {
    expect(empty()).toEqual({ decisions: [] });
    expect(normalizeProsCons({ decisions: 'nope' })).toEqual({ decisions: [] });
  });

  it('drops items with no side, and ratings on the wrong side', () => {
    const data = normalizeProsCons({
      decisions: [{ id: 'd', title: ' T ', items: [
        { id: 'a', side: PRO, text: ' Mountains ', rating: 2 },
        { id: 'b', side: PRO, text: 'Snow', rating: -2 },
        { id: 'c', text: 'No side' },
      ] }],
    });
    expect(data.decisions[0].title).toBe('T');
    expect(data.decisions[0].items).toEqual([
      { id: 'a', side: PRO, text: 'Mountains', rating: 2 },
      { id: 'b', side: PRO, text: 'Snow', rating: null },
    ]);
  });
});

describe('editing', () => {
  it('puts a new decision first', () => {
    const data = addDecision(withDecision(), { id: 'd2', title: 'New car', now: 2 });
    expect(data.decisions.map((d) => d.id)).toEqual(['d2', 'd1']);
  });

  it('renames and removes a decision', () => {
    let data = updateDecision(withDecision(), 'd1', { title: '  Stay in NYC?  ' });
    expect(data.decisions[0].title).toBe('Stay in NYC?');
    data = removeDecision(data, 'd1');
    expect(data.decisions).toEqual([]);
  });

  it('adds, rates, rewords and removes items', () => {
    let data = addItem(withDecision(), 'd1', { id: 'i1', side: CON, text: 'Far from family' });
    expect(data.decisions[0].items[0].rating).toBeNull();
    data = updateItem(data, 'd1', 'i1', { rating: -3 });
    expect(data.decisions[0].items[0].rating).toBe(-3);
    // A con can't be rated as a good thing.
    data = updateItem(data, 'd1', 'i1', { rating: 2 });
    expect(data.decisions[0].items[0].rating).toBeNull();
    data = updateItem(data, 'd1', 'i1', { text: ' Very far from family ' });
    expect(data.decisions[0].items[0].text).toBe('Very far from family');
    data = removeItem(data, 'd1', 'i1');
    expect(data.decisions[0].items).toEqual([]);
  });
});

describe('tally', () => {
  const decision = (items) => ({ items: items.map(([side, rating], i) => ({ id: String(i), side, text: 'x', rating })) });

  it('weighs each side on its own and nets them', () => {
    const t = tally(decision([[PRO, 3], [PRO, 1], [CON, -2], [CON, null]]));
    expect(t).toMatchObject({ pro: 4, con: 2, net: 2, unrated: 1, pros: 2, cons: 2, dealbreakers: 0 });
    expect(t.verdict).toBe('Slightly yes');
  });

  it('leans clearly when one side is much heavier', () => {
    expect(tally(decision([[PRO, 3], [PRO, 2], [CON, -1]])).verdict).toBe('Leaning yes');
    expect(tally(decision([[CON, -2], [CON, -2], [PRO, 1]])).verdict).toBe('Leaning no');
    expect(tally(decision([[PRO, 2], [CON, -2]])).verdict).toBe('A toss-up');
  });

  it('calls out a dealbreaker however many pros there are', () => {
    const t = tally(decision([[PRO, 3], [PRO, 3], [PRO, 3], [CON, -3]]));
    expect(t.net).toBe(6);
    expect(t.dealbreakers).toBe(1);
    expect(t.verdict).toBe('There’s a dealbreaker');
  });

  it('says so when there is nothing to weigh', () => {
    expect(tally(decision([])).verdict).toBe('Nothing listed yet');
    expect(tally(decision([[PRO, null]])).verdict).toBe('Rate them to see where it leans');
  });
});
