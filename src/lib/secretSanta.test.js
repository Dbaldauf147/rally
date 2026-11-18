import { describe, it, expect } from 'vitest';
import {
  looksLikeGiftExchange, secretSantaEnabled, resolvePerson, partnersOf, defaultParticipants, lastDraw,
  buildExclusions, drawNames, drawProblems, drawMatchesParticipants, planSecretSantaSend,
  drawStoreKey, cleanDraws, cleanDrawName, exchangeTitle, MAX_EXTRA_DRAWS, standingNote,
} from './secretSanta';
import { secretSantaEmail } from './secretSantaEmail';
import { encodeReveal, decodeReveal, revealLink } from './secretSantaLink';

// A small deterministic generator so a failing draw can be replayed.
function rngFrom(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const members = {
  dan: { role: 'owner', name: 'Dan', email: 'dan@x.com', rsvp: 'yes' },
  amy: { name: 'Amy', email: 'amy@x.com', plusOneOf: 'dan' },
  bob: { name: 'Bob', email: 'bob@x.com' },
  cat: { name: 'Cat', email: 'cat@x.com', plusOneOf: 'bob' },
  eve: { name: 'Eve', email: '' },
  fay: { name: 'Fay', email: 'fay@x.com', rsvp: 'no' },
  dead: null,
};

describe('secretSantaEnabled', () => {
  it('needs the explicit switch', () => {
    expect(secretSantaEnabled({ secretSanta: { enabled: true } })).toBe(true);
    expect(secretSantaEnabled({ secretSanta: null })).toBe(false);
    expect(secretSantaEnabled({})).toBe(false);
  });
});

describe('partnersOf', () => {
  it('reads a plus-one link in both directions', () => {
    const p = partnersOf(members);
    expect([...p.get('dan')]).toEqual(['amy']);
    expect([...p.get('amy')]).toEqual(['dan']);
    expect([...p.get('cat')]).toEqual(['bob']);
    expect(p.has('eve')).toBe(false);
  });

  it('ignores a link to somebody not on the list, or to themselves', () => {
    const p = partnersOf({ a: { plusOneOf: 'gone' }, b: { plusOneOf: 'b' } });
    expect(p.size).toBe(0);
  });
});

describe('defaultParticipants', () => {
  it('is everyone who has not said no', () => {
    expect(defaultParticipants(members).sort()).toEqual(['amy', 'bob', 'cat', 'dan', 'eve']);
  });
});

describe('resolvePerson', () => {
  it('finds by key, then email, then a unique name', () => {
    expect(resolvePerson({ key: 'bob' }, members)).toBe('bob');
    // Amy's key changed (an email key became a uid) — her address still finds her.
    expect(resolvePerson({ key: 'amy_x_com', email: 'AMY@x.com' }, members)).toBe('amy');
    expect(resolvePerson({ key: 'old', name: ' eve ' }, members)).toBe('eve');
    expect(resolvePerson({ key: 'old', name: 'Zed' }, members)).toBeNull();
  });

  it('will not guess between two people with the same name', () => {
    expect(resolvePerson({ key: 'old', name: 'Sam' }, { a: { name: 'Sam' }, b: { name: 'Sam' } })).toBeNull();
  });
});

describe('lastDraw', () => {
  const history = {
    2024: { pairs: [{ giver: { key: 'dan' }, receiver: { key: 'cat' } }] },
    2025: { pairs: [
      { giver: { key: 'dan', name: 'Dan' }, receiver: { key: 'bob', name: 'Bob' } },
      { giver: { key: 'gone', name: 'Gone' }, receiver: { key: 'dan' } },
      { giver: { key: 'x', email: 'amy@x.com' }, receiver: { key: 'y', name: 'Eve' } },
    ] },
    2026: { out: [], pairs: [{ giver: { key: 'dan' }, receiver: { key: 'eve' } }] },
  };

  it('uses the most recent year before this one, in current keys', () => {
    expect(lastDraw(history, 2026, members)).toEqual({ year: 2025, map: { dan: 'bob', amy: 'eve' } });
  });

  it('skips a year with no draw', () => {
    expect(lastDraw({ 2024: history[2024], 2025: { out: ['fay'] } }, 2026, members).year).toBe(2024);
  });

  it('is empty when there is no history', () => {
    expect(lastDraw(undefined, 2026, members)).toEqual({ year: null, map: {} });
  });
});

describe('drawNames', () => {
  const keys = ['dan', 'amy', 'bob', 'cat', 'eve'];
  const lastMap = { dan: 'bob', eve: 'dan' };
  const exclusions = buildExclusions(keys, members, lastMap);

  it('excludes self, partner and last time', () => {
    expect([...exclusions.get('dan')].sort()).toEqual(['amy', 'bob', 'dan']);
    expect([...exclusions.get('eve')].sort()).toEqual(['dan', 'eve']);
  });

  it('always gives a one-to-one draw that keeps every rule', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const map = drawNames(keys, exclusions, rngFrom(seed));
      expect(map, `seed ${seed}`).not.toBeNull();
      expect(drawMatchesParticipants(map, keys), `seed ${seed}`).toBe(true);
      expect(drawProblems(map, keys, exclusions), `seed ${seed}`).toEqual([]);
      for (const g of keys) {
        expect(map[g]).not.toBe(g);
        expect(map[g]).not.toBe(members[g].plusOneOf);
        expect(members[map[g]].plusOneOf).not.toBe(g);
        if (lastMap[g]) expect(map[g]).not.toBe(lastMap[g]);
      }
    }
  });

  it('does not always produce the same draw', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 50; seed++) seen.add(JSON.stringify(drawNames(keys, exclusions, rngFrom(seed))));
    expect(seen.size).toBeGreaterThan(3);
  });

  it('finds the one draw that fits when the rules leave only one', () => {
    // Three people, each barred from one of the other two: a single cycle is left.
    const ex = new Map([['a', new Set(['a', 'b'])], ['b', new Set(['b', 'c'])], ['c', new Set(['c', 'a'])]]);
    for (let seed = 1; seed <= 50; seed++) {
      expect(drawNames(['a', 'b', 'c'], ex, rngFrom(seed))).toEqual({ a: 'c', b: 'a', c: 'b' });
    }
  });

  it('returns null when no draw fits', () => {
    // One couple and one other: the third person can give to either, but the
    // couple can only both give to the third.
    const m = { a: { plusOneOf: 'b' }, b: {}, c: {} };
    expect(drawNames(['a', 'b', 'c'], buildExclusions(['a', 'b', 'c'], m))).toBeNull();
    expect(drawNames(['a'], new Map())).toBeNull();
  });
});

describe('drawProblems / drawMatchesParticipants', () => {
  const keys = ['a', 'b', 'c'];
  const ex = buildExclusions(keys, { a: {}, b: {}, c: {} }, { a: 'b' });

  it('flags a pick that breaks a rule that changed after the draw', () => {
    expect(drawProblems({ a: 'b', b: 'c', c: 'a' }, keys, ex)).toEqual([{ key: 'a', reason: 'excluded' }]);
    expect(drawProblems({ a: 'c', b: 'a', c: 'b' }, keys, ex)).toEqual([]);
  });

  it('knows when the participants have changed', () => {
    expect(drawMatchesParticipants({ a: 'c', b: 'a', c: 'b' }, keys)).toBe(true);
    expect(drawMatchesParticipants({ a: 'c', b: 'a', c: 'b' }, ['a', 'b'])).toBe(false);
    expect(drawMatchesParticipants({ a: 'c', b: 'a', c: 'b' }, ['a', 'b', 'c', 'd'])).toBe(false);
    expect(drawMatchesParticipants({ a: 'c', b: 'c', c: 'b' }, keys)).toBe(false);
  });
});

describe('planSecretSantaSend', () => {
  const event = { members };
  const pairs = [
    { giver: 'dan', receiver: 'bob' },
    { giver: 'bob', receiver: 'eve' },
    { giver: 'eve', receiver: 'dan' },
  ];

  it('addresses each giver from the event, and lists who has no email', () => {
    expect(planSecretSantaSend(event, pairs)).toEqual({
      mail: [
        { key: 'dan', to: 'dan@x.com', giverName: 'Dan', receiverName: 'Bob' },
        { key: 'bob', to: 'bob@x.com', giverName: 'Bob', receiverName: 'Eve' },
      ],
      noEmail: ['eve'],
    });
  });

  it('can send to just some of the givers', () => {
    expect(planSecretSantaSend(event, pairs, ['bob']).mail.map((m) => m.key)).toEqual(['bob']);
  });

  it('refuses anything that is not a clean one-to-one draw of this event’s guests', () => {
    expect(planSecretSantaSend(event, []).error).toBeTruthy();
    expect(planSecretSantaSend(event, [{ giver: 'dan', receiver: 'stranger' }, { giver: 'bob', receiver: 'dan' }]).error).toMatch(/changed/);
    expect(planSecretSantaSend(event, [{ giver: 'dan', receiver: 'dan' }, { giver: 'bob', receiver: 'eve' }]).error).toMatch(/themselves/);
    expect(planSecretSantaSend(event, [{ giver: 'dan', receiver: 'bob' }, { giver: 'eve', receiver: 'bob' }]).error).toMatch(/one-to-one/);
    expect(planSecretSantaSend(event, [{ giver: 'dan', receiver: 'bob' }, { giver: 'bob', receiver: 'eve' }]).error).toMatch(/one-to-one/);
    expect(planSecretSantaSend(event, 'nope').error).toBeTruthy();
  });
});

describe('secretSantaEmail', () => {
  it('links to the reveal page and never names the person', () => {
    const details = { giverName: 'Dan B', receiverName: 'Bob <b>', eventTitle: 'Xmas', note: '$50 limit', when: 'Friday', location: 'Home', fromName: 'Dan' };
    const { subject, html } = secretSantaEmail({ ...details, link: revealLink(details) });
    expect(subject).toBe('🎅 Your Secret Santa pick for Xmas');
    expect(html).toContain('Hey Dan!');
    expect(html).not.toContain('Bob');
    expect(html).toContain('See who you have');
    expect(html).toMatch(/href="https:\/\/[^"]+\/santa\?k=[\w-]+"/);
    expect(html).toContain('$50 limit');
    expect(html).toContain('Friday');
  });
});

describe('the reveal link', () => {
  it('round-trips everything the page shows, accents and emoji included', () => {
    const details = { giverName: 'Zoë', receiverName: 'José Núñez 🎄', eventTitle: 'Noël', when: 'Fri', location: 'Café', note: 'Under $50 — no gag gifts', fromName: 'Dan' };
    const code = encodeReveal(details);
    expect(code).toMatch(/^[\w-]+$/);
    expect(code).not.toContain('Jos');
    expect(decodeReveal(code)).toEqual(details);
    expect(revealLink(details)).toBe(`https://rally-seven-theta.vercel.app/santa?k=${code}`);
  });

  it('gives null for a link that is cut short, empty, or not ours', () => {
    const code = encodeReveal({ giverName: 'A', receiverName: 'B' });
    expect(decodeReveal(code.slice(0, 10))).toBeNull();
    expect(decodeReveal('')).toBeNull();
    expect(decodeReveal('not-a-link')).toBeNull();
    expect(decodeReveal(encodeReveal({ giverName: 'A', receiverName: '' }))).toBeNull();
  });
});

describe('looksLikeGiftExchange', () => {
  it('spots a gift-exchange title and leaves other events alone', () => {
    for (const t of ['Secret Santa', 'Family Christmas 2026', 'Xmas Round 2', 'Office white elephant', 'secretsanta']) expect(looksLikeGiftExchange(t), t).toBe(true);
    for (const t of ['Guys night', 'Santa Fe trip', 'July 4th BBQ', '', null]) expect(looksLikeGiftExchange(t), String(t)).toBe(false);
  });
});

describe('more than one exchange on an event', () => {
  it('keeps the main exchange where it always was, and each extra one beside it', () => {
    expect(drawStoreKey('e1')).toBe('e1');
    expect(drawStoreKey('e1', '')).toBe('e1');
    expect(drawStoreKey('e1', 'sibs1')).toBe('e1~sibs1');
    expect(drawStoreKey('e1', 'sibs1')).not.toBe(drawStoreKey('e1', 'sibs2'));
  });

  it('tidies a name and caps its length', () => {
    expect(cleanDrawName('  Sibs   Secret  Santa ')).toBe('Sibs Secret Santa');
    expect(cleanDrawName('x'.repeat(200))).toHaveLength(60);
    expect(cleanDrawName(null)).toBe('');
  });

  it('drops malformed, unnamed and repeated entries from the saved list', () => {
    expect(cleanDraws([
      { id: 'a1', name: ' Sibs Secret Santa ' },
      { id: 'a1', name: 'Same id again' },
      { id: 'b2', name: '   ' },
      { id: '', name: 'No id' },
      null,
      'nonsense',
      { id: 'c~3.', name: 'Cousins' },
    ])).toEqual([{ id: 'a1', name: 'Sibs Secret Santa' }, { id: 'c3', name: 'Cousins' }]);
    expect(cleanDraws(undefined)).toEqual([]);
    expect(cleanDraws({ id: 'a', name: 'not a list' })).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, name: `Draw ${i}` }));
    expect(cleanDraws(many)).toHaveLength(MAX_EXTRA_DRAWS);
  });

  it('titles an extra exchange with its own name ahead of the event', () => {
    expect(exchangeTitle('Family Christmas', 'Sibs Secret Santa')).toBe('Sibs Secret Santa · Family Christmas');
    expect(exchangeTitle('Family Christmas', '')).toBe('Family Christmas');
    expect(exchangeTitle('Family Christmas', undefined)).toBe('Family Christmas');
    expect(exchangeTitle('', 'Sibs Secret Santa')).toBe('Sibs Secret Santa');
  });
});

describe('standingNote', () => {
  it('uses the saved standing note, even when it was cleared', () => {
    const history = { 2025: { note: '$50 limit' } };
    expect(standingNote('$75 limit', history)).toBe('$75 limit');
    expect(standingNote('', history)).toBe('');
  });
  it('falls back to the newest year that had a note', () => {
    expect(standingNote(null, { 2023: { note: 'old' }, 2025: { note: '$50 limit' }, 2026: { note: '  ' } })).toBe('$50 limit');
    expect(standingNote(undefined, { 2026: { pairs: [] } })).toBe('');
    expect(standingNote(null, null)).toBe('');
  });
});
