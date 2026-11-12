import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NO_FIT_REASONS, SUB_SEP, applyListEdits, bulkNoFitReasons, categoryState, formatReasons, noFitReasonList, reasonKey, reasonTree, splitReason, subReason, toggleCategory, toggleSubReason, noFitReasonOptions, normalizeReasonList, renameReasons, standardReason,
} from './venueNoFit.js';
import { normalizeVenue } from './weddingVenues.js';

describe('venue not-a-fit reasons', () => {
  it('cleans a list: trims, drops blanks and near-duplicates', () => {
    expect(normalizeReasonList(['  Too   pricey ', '', 'too pricey', 'TOO PRICEY!', 3, 'Rude staff'])).toEqual(['Too pricey', 'Rude staff']);
  });

  it('reuses the spelling already on the list for a typed reason', () => {
    expect(standardReason('too expensive', DEFAULT_NO_FIT_REASONS)).toBe('Too expensive');
    expect(standardReason('didnt respond', DEFAULT_NO_FIT_REASONS)).toBe('Didn’t respond');
    expect(standardReason('  No parking ', DEFAULT_NO_FIT_REASONS)).toBe('No parking');
    expect(standardReason('   ', DEFAULT_NO_FIT_REASONS)).toBe('');
  });

  it('offers starter, saved and in-use reasons, most-used first', () => {
    const venues = [
      { status: 'Not a fit', noFitReasons: ['Not our style', 'No parking'] },
      { status: 'Not a fit', noFitReasons: ['Not our style'] },
      { status: 'Toured', noFitReasons: ['Too expensive'] }, // not counted
    ];
    const opts = noFitReasonOptions(noFitReasonList({ weddingVenueNoFitReasons: ['Rude staff'] }, venues), venues);
    expect(opts[0]).toEqual({ reason: 'Not our style', count: 2 });
    expect(opts[1]).toEqual({ reason: 'No parking', count: 1 });
    expect(opts.map((o) => o.reason)).toContain('Rude staff');
    expect(opts.find((o) => o.reason === 'Too expensive').count).toBe(0);
    expect(opts.length).toBe(DEFAULT_NO_FIT_REASONS.length + 2);
  });

  it('keeps the reasons on a saved venue', () => {
    expect(normalizeVenue({ name: 'A', status: 'Not a fit', noFitReasons: ['Too expensive', ' ', 'too expensive'] }).noFitReasons).toEqual(['Too expensive']);
    expect(normalizeVenue({ name: 'B' }).noFitReasons).toEqual([]);
  });

  it('uses the edited list as-is once there is one', () => {
    const venues = [{ status: 'Not a fit', noFitReasons: ['No parking'] }];
    expect(noFitReasonList({ weddingVenueNoFitReasonList: ['Too expensive', 'Vibe'] }, venues)).toEqual(['Too expensive', 'Vibe']);
    expect(noFitReasonList({ weddingVenueNoFitReasonList: [] }, venues)).toEqual([]);
    expect(noFitReasonList({}, venues)).toContain('No parking');
  });

  it('turns edited rows into a list and renames, merging same-named ones', () => {
    const { list, renames } = applyListEdits([
      { from: 'Too expensive', text: 'Over budget' },
      { from: 'Not our style', text: '' }, // removed
      { from: 'Didn’t respond', text: 'over BUDGET' }, // merged into the first
      { from: 'Date not available', text: 'Date not available' },
      { from: '', text: 'No parking' },
    ]);
    expect(list).toEqual(['Over budget', 'Date not available', 'No parking']);
    expect(renames).toEqual({ 'Too expensive': 'Over budget', 'Didn’t respond': 'Over budget' });
    expect(renameReasons(['Too expensive', 'Didn’t respond', 'Not our style'], renames)).toEqual(['Over budget', 'Not our style']);
  });
});

describe('bulk reasons not a fit', () => {
  const list = ['Too expensive', 'Date not available'];
  const venues = [
    { id: 'a', status: 'Toured', noFitReasons: [] },
    { id: 'b', status: 'Not a fit', noFitReasons: ['Date not available'] },
    { id: 'c', status: 'Not a fit', noFitReasons: ['Too expensive', 'Date not available'] },
    { id: 'z', status: 'Inquired', noFitReasons: [] },
  ];

  it('adds a reason and marks the venues Not a fit, in the list spelling', () => {
    const next = bulkNoFitReasons(venues, ['a', 'b', 'c'], 'add', 'too  EXPENSIVE', list);
    expect(next[0]).toEqual({ id: 'a', status: 'Not a fit', noFitReasons: ['Too expensive'] });
    expect(next[1].noFitReasons).toEqual(['Date not available', 'Too expensive']);
    expect(next[2]).toBe(venues[2]); // already had it: unchanged
    expect(next[3]).toBe(venues[3]); // not picked
  });

  it('adds a reason that is not on the list yet as typed', () => {
    expect(bulkNoFitReasons(venues, ['a'], 'add', 'No parking', list)[0].noFitReasons).toEqual(['No parking']);
  });

  it('removes one reason, leaving the status', () => {
    const next = bulkNoFitReasons(venues, ['a', 'b', 'c'], 'remove', 'Date not available', list);
    expect(next[0]).toBe(venues[0]);
    expect(next[1]).toEqual({ id: 'b', status: 'Not a fit', noFitReasons: [] });
    expect(next[2].noFitReasons).toEqual(['Too expensive']);
  });

  it('clears every reason; a blank reason to add or remove changes nothing', () => {
    const next = bulkNoFitReasons(venues, ['b', 'c', 'z'], 'clear');
    expect(next.map((v) => v.noFitReasons)).toEqual([[], [], [], []]);
    expect(next[3]).toBe(venues[3]);
    expect(bulkNoFitReasons(venues, ['a'], 'add', '  ', list)).toBe(venues);
  });
});

describe('categories and sub-reasons', () => {
  const fee = `Too expensive${SUB_SEP}Venue fee`;
  const pp = `Too expensive${SUB_SEP}Per person`;
  const opts = [
    { reason: 'Date not available', count: 2 },
    { reason: 'Too expensive', count: 1 },
    { reason: fee, count: 3 },
    { reason: pp, count: 0 },
    { reason: `Location${SUB_SEP}No hotels`, count: 0 },
  ];
  const tree = reasonTree(opts);
  const cost = tree.find((n) => n.reason === 'Too expensive');
  const keyed = (list) => new Map(list.map((r) => [reasonKey(r), r]));

  it('reads and writes "Category › Sub-reason"', () => {
    expect(splitReason(fee)).toEqual(['Too expensive', 'Venue fee']);
    expect(splitReason('Date not available')).toEqual(['Date not available', null]);
    expect(subReason(' Too  expensive ', 'Venue fee ')).toBe(fee);
    // Spacing and case around the › don't make a new sub-reason; the first spelling wins.
    expect(normalizeReasonList(['Too expensive ›  venue FEE', fee, 'Too expensive'])).toEqual([`Too expensive${SUB_SEP}venue FEE`, 'Too expensive']);
  });

  it('builds the tree: categories once, sub-reasons under them, implied categories added', () => {
    expect(tree.map((n) => [n.reason, n.children.map((c) => splitReason(c.reason)[1]), n.count])).toEqual([
      ['Date not available', [], 2],
      ['Too expensive', ['Venue fee', 'Per person'], 3],
      ['Location', ['No hotels'], 0],
    ]);
    expect(tree[2].implied).toBe(true);
  });

  it('ticking a category takes all of it; unticking clears every sub-reason', () => {
    let c = toggleCategory(new Map(), cost);
    expect([...c.values()]).toEqual(['Too expensive']);
    expect(categoryState(cost, c)).toBe('all');
    c = toggleCategory(keyed([fee]), cost); // some → all
    expect([...c.values()]).toEqual(['Too expensive']);
    expect([...toggleCategory(c, cost).values()]).toEqual([]);
  });

  it('ticking sub-reasons keeps exactly those, even all of them; one off a whole category leaves the rest', () => {
    let c = toggleSubReason(new Map(), cost, cost.children[0]);
    expect([...c.values()]).toEqual([fee]);
    expect(categoryState(cost, c)).toBe('some');
    c = toggleSubReason(c, cost, cost.children[1]);
    expect([...c.values()]).toEqual([fee, pp]);
    expect(categoryState(cost, c)).toBe('all');
    c = toggleSubReason(c, cost, cost.children[0]);
    expect([...c.values()]).toEqual([pp]);
    // From the whole category, unticking one leaves the others.
    expect([...toggleSubReason(keyed(['Too expensive']), cost, cost.children[0]).values()]).toEqual([pp]);
    // other categories are left alone
    expect([...toggleSubReason(keyed(['Date not available']), cost, cost.children[0]).values()]).toEqual(['Date not available', fee]);
  });

  it('reads a venue\'s reasons grouped under their categories', () => {
    expect(formatReasons([fee, pp, 'Date not available'])).toBe('Too expensive: Venue fee, Per person · Date not available');
    expect(formatReasons(['Too expensive', fee])).toBe('Too expensive');
    expect(formatReasons([])).toBe('');
  });

  it('a renamed category carries its sub-reasons onto venues', () => {
    expect(renameReasons([fee, 'Too expensive'], { 'Too expensive': 'Cost', [fee]: `Cost${SUB_SEP}Venue fee` })).toEqual([`Cost${SUB_SEP}Venue fee`, 'Cost']);
  });
});

describe('bulk reasons with categories', () => {
  const fee = `Too expensive${SUB_SEP}Venue fee`;
  it('a whole category replaces its sub-reasons; a sub-reason under a whole category adds nothing', () => {
    const vs = [
      { id: 'a', status: 'Not a fit', noFitReasons: [fee, 'Date not available'] },
      { id: 'b', status: 'Not a fit', noFitReasons: ['Too expensive'] },
    ];
    const next = bulkNoFitReasons(vs, ['a', 'b'], 'add', 'Too expensive', []);
    expect(next[0].noFitReasons).toEqual(['Date not available', 'Too expensive']);
    expect(next[1]).toBe(vs[1]);
    expect(bulkNoFitReasons(vs, ['b'], 'add', fee, [])[1]).toBe(vs[1]);
  });
});

describe('sub-reasons through the Why not a fit column', () => {
  it('export text reads back to the same reasons', async () => {
    const { cellValue, withCellValue } = await import('./venueTable.js');
    const v = normalizeVenue({ id: 'v', name: 'V', status: 'Not a fit', noFitReasons: [`Too expensive${SUB_SEP}Venue fee`, 'Date not available'] });
    const text = cellValue(v, 'noFit');
    const back = withCellValue(normalizeVenue({ id: 'v', name: 'V', status: 'Not a fit' }), 'noFit', text);
    expect(back.noFitReasons).toEqual(v.noFitReasons);
  });
});
