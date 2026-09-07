import { describe, it, expect } from 'vitest';
import { normalizeHandle, displayHandle, venmoUrl, chargeNote, NOTE_MAX } from './venmo';

describe('normalizeHandle', () => {
  it('takes a plain handle', () => {
    expect(normalizeHandle('danbaldauf')).toBe('danbaldauf');
  });

  it('drops the @ people type out of habit', () => {
    expect(normalizeHandle('@danbaldauf')).toBe('danbaldauf');
    expect(normalizeHandle('  @@danbaldauf  ')).toBe('danbaldauf');
  });

  it('pulls the handle out of a pasted profile link', () => {
    expect(normalizeHandle('https://venmo.com/danbaldauf')).toBe('danbaldauf');
    expect(normalizeHandle('https://venmo.com/u/danbaldauf')).toBe('danbaldauf');
    expect(normalizeHandle('venmo.com/u/danbaldauf?txn=pay')).toBe('danbaldauf');
    expect(normalizeHandle('https://www.venmo.com/Dan-Baldauf')).toBe('Dan-Baldauf');
  });

  it('keeps the punctuation Venmo allows', () => {
    expect(normalizeHandle('Dan-Baldauf_1.0')).toBe('Dan-Baldauf_1.0');
  });

  it('refuses anything that is not a handle', () => {
    expect(normalizeHandle('')).toBe('');
    expect(normalizeHandle(null)).toBe('');
    expect(normalizeHandle('dan baldauf')).toBe('');
    expect(normalizeHandle('dan@example.com')).toBe('');
    expect(normalizeHandle('a')).toBe('');
    expect(normalizeHandle('x'.repeat(31))).toBe('');
  });
});

describe('displayHandle', () => {
  it('puts the @ back for showing', () => {
    expect(displayHandle('danbaldauf')).toBe('@danbaldauf');
    expect(displayHandle('@danbaldauf')).toBe('@danbaldauf');
  });

  it('is empty when there is nothing usable', () => {
    expect(displayHandle('dan baldauf')).toBe('');
    expect(displayHandle('')).toBe('');
  });
});

describe('venmoUrl', () => {
  it('builds a charge link', () => {
    const url = venmoUrl({ handle: '@danbaldauf', amount: 16.25, note: 'Labor Day — Pizza' });
    expect(url).toBe('https://venmo.com/danbaldauf?txn=charge&amount=16.25&note=Labor+Day+%E2%80%94+Pizza');
  });

  it('can pay instead of charge', () => {
    expect(venmoUrl({ handle: 'dan', amount: 5, txn: 'pay' }))
      .toBe('https://venmo.com/dan?txn=pay&amount=5.00');
  });

  it('treats anything but pay as a charge', () => {
    expect(venmoUrl({ handle: 'dan', amount: 5, txn: 'nonsense' })).toContain('txn=charge');
  });

  it('writes the amount to the cent Venmo will read', () => {
    expect(venmoUrl({ handle: 'dan', amount: 16.2 })).toContain('amount=16.20');
    expect(venmoUrl({ handle: 'dan', amount: '7' })).toContain('amount=7.00');
  });

  it('has nothing to open without a handle or an amount', () => {
    expect(venmoUrl({ handle: '', amount: 10 })).toBe('');
    expect(venmoUrl({ handle: 'dan', amount: 0 })).toBe('');
    expect(venmoUrl({ handle: 'dan', amount: -5 })).toBe('');
    expect(venmoUrl({ handle: 'dan', amount: 'lots' })).toBe('');
    expect(venmoUrl({})).toBe('');
  });

  it('trims a note Venmo would cut off anyway', () => {
    const url = venmoUrl({ handle: 'dan', amount: 1, note: 'y'.repeat(200) });
    expect(decodeURIComponent(new URL(url).searchParams.get('note')).length).toBe(NOTE_MAX);
  });

  it('leaves an empty note out rather than sending a blank one', () => {
    expect(venmoUrl({ handle: 'dan', amount: 1, note: '   ' })).not.toContain('note=');
  });
});

describe('chargeNote', () => {
  it('joins the trip and the charge', () => {
    expect(chargeNote('Labor Day', 'Pizza')).toBe('Labor Day — Pizza');
  });

  it('uses whichever half it has', () => {
    expect(chargeNote('Labor Day', '')).toBe('Labor Day');
    expect(chargeNote('', 'Pizza')).toBe('Pizza');
    expect(chargeNote('', '')).toBe('');
  });

  it('stays inside what Venmo will show', () => {
    expect(chargeNote('t'.repeat(70), 'e'.repeat(70)).length).toBe(NOTE_MAX);
  });
});
