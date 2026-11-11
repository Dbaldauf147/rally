import { describe, expect, it } from 'vitest';
import { DEFAULT_NO_FIT_REASONS, noFitReasonOptions, normalizeReasonList, standardReason } from './venueNoFit.js';
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
    const opts = noFitReasonOptions(['Rude staff'], venues);
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
});
