// The email itself. The stats are covered in weddingStats.test.js; this is
// about what actually reaches the inbox — the numbers, the wording that changes
// with state, and escaping guest-supplied text.
import { describe, it, expect } from 'vitest';
import { buildEmailHtml, buildDigestForUser } from '../api/wedding-digest.js';
import { weddingStats, statsDelta } from './weddingStats.js';

const at = (address, city = 'Northport', state = 'NY', zip = '11768') => ({ address, city, state, zip });
const WHEN = new Date('2026-08-30T13:00:00Z');

const LIST = [
  { firstName: 'Bill', lastName: "O'Neill", email: 'b@x.com', phone: '1', group: 'Family', ...at('31 Norwood Ave') },
  { firstName: 'Laurie', lastName: "O'Neill", email: '', phone: '2', group: 'Family', ...at('31 Norwood Ave') },
  { firstName: 'Kerry', lastName: 'Lupton', email: '', phone: '', group: 'College' },
];

const html = (contacts, prev) => {
  const s = weddingStats(contacts);
  return buildEmailHtml(s, statsDelta(s, prev), 'America/New_York', WHEN);
};

describe('wedding digest email', () => {
  it('reports guests and households as different numbers', () => {
    const out = html(LIST);
    expect(out).toContain('>3<'); // 3 guests
    expect(out).toContain('Households');
    expect(out).toMatch(/Ready to mail/);
  });

  it('names the households that cannot be posted to', () => {
    const out = html(LIST);
    expect(out).toContain('1 household without a mailable address');
    expect(out).toContain('Kerry Lupton');
  });

  it('says so plainly when everything is mailable', () => {
    const out = html([LIST[0], LIST[1]]);
    expect(out).toContain('ready to post');
    expect(out).not.toContain('without a mailable address');
  });

  it('escapes apostrophes in guest names', () => {
    // "Bill & Laurie O'Neill" is a real household on this list; unescaped it
    // would break the surrounding markup.
    const out = html([
      { firstName: 'Bill', lastName: "O'Neill" },
      { firstName: 'Laurie', lastName: "O'Neill" },
    ]);
    expect(out).toContain('O&#39;Neill');
    expect(out).not.toMatch(/>Bill & Laurie O'Neill</);
  });

  it('escapes ampersands and angle brackets in group names', () => {
    const out = html([{ firstName: 'A', group: 'Friends & <family>', ...at('1 Rd') }]);
    expect(out).toContain('Friends &amp; &lt;family&gt;');
  });

  it('explains itself on a first run rather than inventing movement', () => {
    expect(html(LIST, null)).toContain('First digest');
  });

  it('says nothing changed on a quiet week', () => {
    const s = weddingStats(LIST);
    const out = html(LIST, { guests: s.guests, households: s.households, mailable: s.mailable, missingAddress: s.missingAddress });
    expect(out).toContain('No change since last week');
  });

  it('spells out movement in both directions', () => {
    const out = html(LIST, { guests: 1, households: 1, mailable: 0, missingAddress: 2 });
    expect(out).toContain('Since last week');
    expect(out).toContain('+2 guests');
    expect(out).toContain('−1 missing an address');
  });

  it('caps a long missing-address list', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ firstName: `P${i}`, lastName: 'X' }));
    const out = html(many);
    expect(out).toContain('more');
    // 15 shown, so 25 hidden.
    expect(out).toContain('+25 more');
  });

  it('renders a percentage bar that stays within bounds', () => {
    const out = html(LIST);
    const m = /width:(\d+)%/.exec(out);
    expect(m).toBeTruthy();
    const pct = Number(m[1]);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });
});

describe('buildDigestForUser', () => {
  it('skips a user with no contacts', () => {
    expect(buildDigestForUser({ email: 'a@x.com', weddingContacts: [] }).skipped).toBe('no contacts on the wedding list');
  });

  it('skips a user with no address to send to', () => {
    expect(buildDigestForUser({ weddingContacts: LIST }).skipped).toBe('no email');
  });

  it('prefers the digest email over the account email', () => {
    const built = buildDigestForUser({
      email: 'account@x.com',
      weddingDigest: { email: 'wedding@x.com' },
      weddingContacts: LIST,
    });
    expect(built.email).toBe('wedding@x.com');
  });

  it('falls back to the account email', () => {
    expect(buildDigestForUser({ email: 'account@x.com', weddingContacts: LIST }).email).toBe('account@x.com');
  });

  it('puts the readiness numbers in the subject', () => {
    const built = buildDigestForUser({ email: 'a@x.com', weddingContacts: LIST }, WHEN);
    expect(built.subject).toContain('2 households ready');
    expect(built.subject).toContain('1 missing an address');
  });

  it('uses a clean subject when nothing is missing', () => {
    const built = buildDigestForUser({ email: 'a@x.com', weddingContacts: [LIST[0], LIST[1]] }, WHEN);
    expect(built.subject).toMatch(/all 1 household/);
  });

  it('returns the snapshot the next run compares against', () => {
    const built = buildDigestForUser({ email: 'a@x.com', weddingContacts: LIST }, WHEN);
    expect(Object.keys(built.snapshot).sort()).toEqual(['guests', 'households', 'mailable', 'missingAddress']);
  });
});
