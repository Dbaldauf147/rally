// The email itself. The checklist logic is covered in
// weddingChecklistDigest.test.js and the guest-list numbers in
// weddingStats.test.js; this is about what actually reaches the inbox — what is
// in it, the wording that changes with state, and escaping text the owner typed.
import { describe, it, expect } from 'vitest';
import { buildEmailHtml, buildDigestForUser, digestRecipients } from '../api/wedding-digest.js';
import { weddingStats } from './weddingStats.js';
import { checklistSnapshot } from './weddingChecklistDigest.js';

const at = (address, city = 'Northport', state = 'NY', zip = '11768') => ({ address, city, state, zip });
const WHEN = new Date('2026-08-30T13:00:00Z');

const LIST = [
  { firstName: 'Bill', lastName: "O'Neill", email: 'b@x.com', phone: '1', group: 'Family', ...at('31 Norwood Ave') },
  { firstName: 'Laurie', lastName: "O'Neill", email: '', phone: '2', group: 'Family', ...at('31 Norwood Ave') },
  { firstName: 'Kerry', lastName: 'Lupton', email: '', phone: '', group: 'College' },
];

// A small checklist of our own, so these tests don't move every time the seed
// list is reworded.
const CHECK = {
  phases: [
    {
      id: 'now',
      title: 'Now',
      when: 'allow 1–3 months',
      tasks: [
        { id: 'venue', text: 'Book the venue', note: 'Everything counts back from it.', milestone: true },
        { id: 'budget', text: 'Settle the budget' },
      ],
    },
    {
      id: 'later',
      title: 'Later',
      tasks: [
        { id: 'cake', text: 'Book the cake' },
        { id: 'band', text: 'Book the band' },
      ],
    },
  ],
  done: {},
};

const ticked = (...keys) => ({ ...CHECK, done: Object.fromEntries(keys.map((k) => [k, true])) });
const html = (list = CHECK, delta = null, stats = null) => buildEmailHtml(list, delta, 'America/New_York', WHEN, stats);

describe('wedding digest email', () => {
  it('is the checklist — every task, under its phase', () => {
    const out = html();
    expect(out).toContain('Wedding checklist');
    for (const text of ['Book the venue', 'Settle the budget', 'Book the cake', 'Book the band']) {
      expect(out).toContain(text);
    }
    expect(out).toContain('Now');
    expect(out).toContain('Later');
  });

  it('leads with how much of it is done', () => {
    expect(html(ticked('now.venue'))).toContain('1 of 4 done');
    expect(html(ticked('now.venue'))).toContain('25% of the checklist complete');
  });

  it('names the next thing to do, and the guidance that came with it', () => {
    const out = html(ticked('now.venue'));
    expect(out).toContain('Next up');
    expect(out).toContain('Settle the budget');
    const first = html();
    expect(first).toContain('Everything counts back from it.');
  });

  it('drops a task’s note once it is done — the guidance was for doing it', () => {
    expect(html(ticked('now.venue'))).not.toContain('Everything counts back from it.');
  });

  it('strikes through what is finished rather than hiding it', () => {
    const out = html(ticked('now.venue'));
    expect(out).toContain('line-through');
    expect(out).toContain('Book the venue');
  });

  it('collapses a phase with everything ticked to one line', () => {
    const out = html(ticked('later.cake', 'later.band'));
    expect(out).toContain('all 2 done');
    // The heading survives; the two finished task rows do not.
    expect(out).toContain('Later');
    expect(out).not.toContain('Book the cake');
  });

  it('calls out milestones that are still ahead', () => {
    expect(html()).toContain('Milestones still ahead');
    expect(html(ticked('now.venue'))).not.toContain('Milestones still ahead');
  });

  it('says so plainly when the whole list is done', () => {
    const out = html(ticked('now.venue', 'now.budget', 'later.cake', 'later.band'));
    expect(out).toContain('Every task on the checklist is done');
    expect(out).not.toContain('Next up');
  });

  it('explains itself on a first run rather than inventing movement', () => {
    expect(html()).toContain('First digest');
  });

  it('says nothing moved on a quiet week', () => {
    const list = ticked('now.venue');
    const delta = { ticked: [], unticked: 0, added: 0, any: false };
    expect(buildEmailHtml(list, delta, 'America/New_York', WHEN, null))
      .toContain('Nothing ticked off since last week');
  });

  it('names what got done this week', () => {
    const delta = { ticked: [{ key: 'now.venue', text: 'Book the venue' }], unticked: 0, added: 0, any: true };
    const out = buildEmailHtml(ticked('now.venue'), delta, 'America/New_York', WHEN, null);
    expect(out).toContain('Done this week');
    expect(out).toContain('Book the venue');
    expect(out).toContain('+1');
  });

  it('reports a task that came back off the list', () => {
    const delta = { ticked: [], unticked: 2, added: 0, any: true };
    expect(buildEmailHtml(CHECK, delta, 'America/New_York', WHEN, null)).toContain('2 reopened');
  });

  it('caps a long week of progress', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ key: `k${i}`, text: `Task ${i}` }));
    const out = buildEmailHtml(CHECK, { ticked: many, unticked: 0, added: 0, any: true }, 'America/New_York', WHEN, null);
    expect(out).toContain('+10 more');
    expect(out).not.toContain('Task 20');
  });

  it('escapes text the owner typed into a task', () => {
    const list = {
      phases: [{ id: 'p', title: 'A & B <b>', tasks: [{ id: 't', text: "Ring O'Neill & <script>" }] }],
      done: {},
    };
    const out = html(list);
    expect(out).toContain('&amp;');
    expect(out).toContain('&#39;');
    expect(out).not.toContain('<script>');
  });

  it('renders a percentage bar that stays within bounds', () => {
    for (const list of [CHECK, ticked('now.venue'), ticked('now.venue', 'now.budget', 'later.cake', 'later.band')]) {
      const pct = Number(/width:(\d+)%;background:#16a34a/.exec(html(list))[1]);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });
});

describe('the guest list, as a footnote', () => {
  it('rides along at the bottom rather than being the message', () => {
    const out = html(CHECK, null, weddingStats(LIST));
    expect(out).toContain('Guest list');
    expect(out).toContain('3 guests in 2 households');
    expect(out).toContain('1 still without a mailable address');
  });

  it('says so when every address is in', () => {
    const out = html(CHECK, null, weddingStats([LIST[0], LIST[1]]));
    expect(out).toContain('every address is in');
  });

  it('is absent when nobody has been typed in yet', () => {
    expect(html(CHECK, null, null)).not.toContain('Guest list');
  });

  it('escapes apostrophes and ampersands in guest-supplied text', () => {
    const out = html(CHECK, null, weddingStats(LIST));
    expect(out).not.toContain("O'Neill</");
  });
});

describe('buildDigestForUser', () => {
  const user = (over = {}) => ({ email: 'a@x.com', weddingChecklist: CHECK, ...over });

  it('sends on the strength of the checklist, with no guest list at all', () => {
    const built = buildDigestForUser(user({ weddingContacts: [] }), WHEN);
    expect(built.skipped).toBeUndefined();
    expect(built.html).toContain('Book the venue');
  });

  it('skips a checklist that has been emptied', () => {
    expect(buildDigestForUser(user({ weddingChecklist: { phases: [], done: {} } })).skipped)
      .toBe('nothing on the wedding checklist');
  });

  it('falls back to the built-in list for an account that has never edited one', () => {
    // No weddingChecklist field at all: normalizeChecklist seeds it, so there
    // is a full list to send rather than nothing.
    const built = buildDigestForUser({ email: 'a@x.com' }, WHEN);
    expect(built.skipped).toBeUndefined();
    expect(built.sum.total).toBeGreaterThan(50);
  });

  it('skips a user with no address to send to', () => {
    expect(buildDigestForUser({ weddingChecklist: CHECK }).skipped).toBe('no email');
  });

  it('prefers the digest email over the account email', () => {
    const built = buildDigestForUser(user({ weddingDigest: { email: 'wedding@x.com' } }));
    expect(built.email).toBe('wedding@x.com');
  });

  it('falls back to the account email', () => {
    expect(buildDigestForUser(user()).email).toBe('account@x.com'.replace('account', 'a'));
  });

  it('puts the progress and the next task in the subject', () => {
    const built = buildDigestForUser(user({ weddingChecklist: ticked('now.venue') }), WHEN);
    expect(built.subject).toContain('1/4 done');
    expect(built.subject).toContain('next: Settle the budget');
  });

  it('uses a clean subject when the list is finished', () => {
    const done = ticked('now.venue', 'now.budget', 'later.cake', 'later.band');
    expect(buildDigestForUser(user({ weddingChecklist: done }), WHEN).subject)
      .toBe('💍 Wedding checklist — everything is done');
  });

  it('returns a snapshot carrying both halves, so next week can compare', () => {
    const built = buildDigestForUser(user({ weddingContacts: LIST }), WHEN);
    expect(built.snapshot.checklist).toEqual(checklistSnapshot(CHECK));
    expect(Object.keys(built.snapshot).sort())
      .toEqual(['checklist', 'guests', 'households', 'mailable', 'missingAddress']);
  });

  it('snapshots the checklist even with no guest list to snapshot', () => {
    const built = buildDigestForUser(user({ weddingContacts: [] }), WHEN);
    expect(Object.keys(built.snapshot)).toEqual(['checklist']);
  });

  it('measures the week against the checklist half of last week’s snapshot', () => {
    const built = buildDigestForUser(user({
      weddingChecklist: ticked('now.venue'),
      weddingDigest: { email: 'a@x.com', lastSnapshot: { checklist: checklistSnapshot(CHECK) } },
    }), WHEN);
    expect(built.html).toContain('Done this week');
    expect(built.html).toContain('Book the venue');
  });
});

describe('digestRecipients', () => {
  it('sends to every address on the list', () => {
    expect(digestRecipients({ emails: ['a@x.com', 'b@x.com'] }))
      .toEqual(['a@x.com', 'b@x.com']);
  });

  // A config saved before the list existed still holds one address in `email`.
  it('keeps a single-address setup working without re-saving it', () => {
    expect(digestRecipients({ email: 'old@x.com' })).toEqual(['old@x.com']);
    expect(digestRecipients({ email: 'old@x.com', emails: ['new@x.com'] }))
      .toEqual(['new@x.com', 'old@x.com']);
  });

  it('does not send twice to the same person', () => {
    // For a while a config holds the same address in both fields.
    expect(digestRecipients({ email: 'Dan@X.com', emails: ['dan@x.com'] })).toEqual(['dan@x.com']);
    expect(digestRecipients({ emails: ['a@x.com', 'A@X.com'] })).toEqual(['a@x.com']);
  });

  it('drops anything that is not an address', () => {
    expect(digestRecipients({ emails: ['a@x.com', 'not an email', '', null, 'b@'] }))
      .toEqual(['a@x.com']);
  });

  it('trims what was pasted', () => {
    expect(digestRecipients({ emails: ['  a@x.com  '] })).toEqual(['a@x.com']);
  });

  it('falls back to the account address only when nobody is named', () => {
    expect(digestRecipients({}, 'me@x.com')).toEqual(['me@x.com']);
    expect(digestRecipients({ emails: [] }, 'me@x.com')).toEqual(['me@x.com']);
    // An emptied list is a choice, but there is nothing to send to either way.
    expect(digestRecipients({ emails: ['a@x.com'] }, 'me@x.com')).toEqual(['a@x.com']);
  });

  it('has nothing to send to when there is nothing anywhere', () => {
    expect(digestRecipients({})).toEqual([]);
    expect(digestRecipients({}, 'not an email')).toEqual([]);
    expect(digestRecipients()).toEqual([]);
  });

  it('is a shared summary, not a mailing list', () => {
    const many = Array.from({ length: 25 }, (_, i) => `p${i}@x.com`);
    expect(digestRecipients({ emails: many })).toHaveLength(10);
  });
});

describe('who the built digest goes to', () => {
  it('carries the whole list through to the send', () => {
    const built = buildDigestForUser({
      weddingChecklist: CHECK,
      weddingDigest: { emails: ['a@x.com', 'b@x.com'] },
    });
    expect(built.emails).toEqual(['a@x.com', 'b@x.com']);
    expect(built.email).toBe('a@x.com'); // still there for anything reading one
  });

  it('skips when nobody is on the list', () => {
    expect(buildDigestForUser({ weddingChecklist: CHECK, weddingDigest: { emails: [] } }))
      .toMatchObject({ skipped: 'no email' });
  });
});
