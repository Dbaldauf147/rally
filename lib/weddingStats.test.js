import { describe, it, expect } from 'vitest';
import {
  weddingStats, households, householdLabel, hasMailableAddress, statsDelta, snapshotOf, fullName,
} from './weddingStats.js';

const at = (address, city = 'Northport', state = 'NY', zip = '11768') => ({ address, city, state, zip });

describe('hasMailableAddress', () => {
  it('needs all four parts', () => {
    expect(hasMailableAddress({ ...at('1 Main St') })).toBe(true);
    expect(hasMailableAddress({ address: '1 Main St', city: '', state: 'NY', zip: '11768' })).toBe(false);
    expect(hasMailableAddress({ address: '', city: 'X', state: 'NY', zip: '11768' })).toBe(false);
    expect(hasMailableAddress({})).toBe(false);
  });

  it('treats whitespace as missing', () => {
    expect(hasMailableAddress({ address: '  ', city: 'X', state: 'NY', zip: '1' })).toBe(false);
  });
});

describe('households', () => {
  it('groups people at the same address', () => {
    const hh = households([
      { firstName: 'Bill', lastName: "O'Neill", ...at('31 Norwood Ave') },
      { firstName: 'Laurie', lastName: "O'Neill", ...at('31 Norwood Ave') },
    ]);
    expect(hh).toHaveLength(1);
    expect(hh[0].members).toHaveLength(2);
  });

  it('keeps same-street different-town addresses apart', () => {
    // The error this guards against is merging two families into one invitation.
    const hh = households([
      { firstName: 'A', ...at('147 Highland Avenue', 'Northport', 'NY', '11768') },
      { firstName: 'B', ...at('147 Highland Avenue', 'Elsewhere', 'NY', '99999') },
    ]);
    expect(hh).toHaveLength(2);
  });

  it('ignores case and padding when matching', () => {
    const hh = households([
      { firstName: 'A', ...at('31 Norwood Ave') },
      { firstName: 'B', ...at('  31 NORWOOD AVE  ') },
    ]);
    expect(hh).toHaveLength(1);
  });

  it('gives everyone without an address their own household', () => {
    const hh = households([
      { firstName: 'A', address: '' },
      { firstName: 'B', address: '' },
    ]);
    expect(hh).toHaveLength(2);
    expect(hh.every((h) => h.mailable === false)).toBe(true);
  });

  it('returns nothing for an empty or missing list', () => {
    expect(households([])).toEqual([]);
    expect(households(null)).toEqual([]);
  });
});

describe('householdLabel', () => {
  it('joins first names when the surname is shared', () => {
    expect(householdLabel({ members: [
      { firstName: 'Bill', lastName: "O'Neill" },
      { firstName: 'Laurie', lastName: "O'Neill" },
    ] })).toBe("Bill & Laurie O'Neill");
  });

  it('uses full names when surnames differ', () => {
    expect(householdLabel({ members: [
      { firstName: 'Kaleigh', lastName: 'Bernier' },
      { firstName: 'Nick', lastName: 'Graci' },
    ] })).toBe('Kaleigh Bernier & Nick Graci');
  });

  it('handles one person and no name', () => {
    expect(householdLabel({ members: [{ firstName: 'Ada', lastName: 'Lovelace' }] })).toBe('Ada Lovelace');
    expect(householdLabel({ members: [{}] })).toBe('Unnamed');
    expect(householdLabel({})).toBe('Unnamed');
  });
});

describe('weddingStats', () => {
  const list = [
    { firstName: 'Bill', lastName: "O'Neill", email: 'b@x.com', phone: '1', group: 'Family', category: 'A', ...at('31 Norwood Ave') },
    { firstName: 'Laurie', lastName: "O'Neill", email: '', phone: '2', group: 'Family', category: 'A', ...at('31 Norwood Ave') },
    { firstName: 'Solo', lastName: 'Person', email: '', phone: '', group: 'College', category: '', ...at('9 Oak Rd') },
    { firstName: 'No', lastName: 'Address', email: '', phone: '', group: '', category: '' },
  ];

  it('counts guests and households separately', () => {
    const s = weddingStats(list);
    expect(s.guests).toBe(4);
    expect(s.households).toBe(3); // O'Neills share one
  });

  it('separates mailable households from the rest', () => {
    const s = weddingStats(list);
    expect(s.mailable).toBe(2);
    expect(s.missingAddress).toBe(1);
    expect(s.missingAddressNames).toEqual(['No Address']);
  });

  it('counts missing contact details per person', () => {
    const s = weddingStats(list);
    expect(s.missingEmail).toBe(3);
    expect(s.missingPhone).toBe(2);
  });

  it('tallies groups with the blank bucket last', () => {
    const s = weddingStats(list);
    expect(s.byGroup).toEqual([
      { label: 'Family', count: 2 },
      { label: 'College', count: 1 },
      { label: 'No group', count: 1 },
    ]);
  });

  it('keeps the blank bucket last even when it is the biggest', () => {
    const s = weddingStats([
      { group: '' }, { group: '' }, { group: '' }, { group: 'Family' },
    ]);
    expect(s.byGroup[s.byGroup.length - 1]).toEqual({ label: 'No group', count: 3 });
  });

  it('survives an empty list and junk entries', () => {
    const s = weddingStats([]);
    expect(s).toMatchObject({ guests: 0, households: 0, mailable: 0, missingAddress: 0 });
    expect(weddingStats(null).guests).toBe(0);
    expect(weddingStats([null, undefined]).guests).toBe(0);
  });
});

describe('statsDelta', () => {
  const now = { guests: 10, households: 6, mailable: 5, missingAddress: 1 };

  it('reports no deltas at all on a first run', () => {
    // Nothing to compare with; claiming +10 this week would be a lie.
    expect(statsDelta(now, null)).toBeNull();
    expect(statsDelta(now, undefined)).toBeNull();
  });

  it('computes movement in both directions', () => {
    const d = statsDelta(now, { guests: 7, households: 5, mailable: 3, missingAddress: 2 });
    expect(d).toMatchObject({ guests: 3, households: 1, mailable: 2, missingAddress: -1, any: true });
  });

  it('flags a quiet week', () => {
    expect(statsDelta(now, { ...now }).any).toBe(false);
  });

  it('treats unusable previous values as no movement', () => {
    const d = statsDelta(now, { guests: 'oops' });
    expect(d.guests).toBe(0);
  });
});

describe('snapshotOf', () => {
  it('keeps exactly the fields statsDelta compares', () => {
    const snap = snapshotOf(weddingStats([{ firstName: 'A', ...at('1 Rd') }]));
    expect(Object.keys(snap).sort()).toEqual(['guests', 'households', 'mailable', 'missingAddress']);
  });
});

describe('fullName', () => {
  it('joins what is present', () => {
    expect(fullName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada Lovelace');
    expect(fullName({ firstName: 'Ada' })).toBe('Ada');
    expect(fullName({})).toBe('');
  });
});
