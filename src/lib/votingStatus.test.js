import { describe, it, expect } from 'vitest';
import { summarizeVoting, renderVotingStatusEmail, rangeLabel, scoreOption } from './votingStatus';

const opt = (id, startDate, votes = {}, extra = {}) => ({ id, startDate, endDate: startDate, votes, ...extra });
const v = (vote, name, topPick) => ({ vote, name, ...(topPick ? { topPick: true } : {}) });

describe('scoreOption', () => {
  it('counts each kind of vote', () => {
    const s = scoreOption(opt('a', '2026-10-01', {
      u1: v('yes', 'Ann'), u2: v('maybe', 'Ben'), u3: v('no', 'Cal'), u4: v('none', 'Dee'),
    }));
    expect([s.yes, s.maybe, s.no]).toEqual([1, 1, 1]);
  });

  it('weights a Works as two Maybes, the way the poll does', () => {
    expect(scoreOption(opt('a', '2026-10-01', { u1: v('yes', 'A') })).score).toBe(2);
    expect(scoreOption(opt('b', '2026-10-02', { u1: v('maybe', 'A'), u2: v('maybe', 'B') })).score).toBe(2);
  });

  it('counts top picks', () => {
    const s = scoreOption(opt('a', '2026-10-01', { u1: v('yes', 'A', true), u2: v('yes', 'B') }));
    expect(s.topPicks).toBe(1);
  });
});

describe('summarizeVoting', () => {
  const members = {
    u1: { name: 'Ann', email: 'ann@example.com' },
    u2: { name: 'Ben', email: 'ben@example.com' },
    u3: { name: 'Cal', email: 'cal@example.com' },
  };

  it('picks the highest-scoring open option as the leader', () => {
    const s = summarizeVoting({ members }, [
      opt('a', '2026-10-01', { u1: v('maybe', 'Ann') }),
      opt('b', '2026-10-08', { u1: v('yes', 'Ann'), u2: v('yes', 'Ben') }),
    ]);
    expect(s.leaderId).toBe('b');
    expect(s.open[0].id).toBe('b');
  });

  it('leads nothing when no one has voted', () => {
    const s = summarizeVoting({ members }, [opt('a', '2026-10-01'), opt('b', '2026-10-08')]);
    expect(s.leaderId).toBe(null);
  });

  it('leaves closed and reference dates out of the running', () => {
    const s = summarizeVoting({ members }, [
      opt('a', '2026-10-01', { u1: v('yes', 'Ann') }, { closed: true }),
      opt('b', '2026-10-08', {}, { noVote: true, note: 'Backup option' }),
      opt('c', '2026-10-15', { u1: v('maybe', 'Ann') }),
    ]);
    expect(s.open.map(o => o.id)).toEqual(['c']);
    expect(s.references.map(o => o.id)).toEqual(['b']);
    expect(s.leaderId).toBe('c');
  });

  it('counts someone done only once they have voted on every open date', () => {
    const s = summarizeVoting({ members }, [
      opt('a', '2026-10-01', { u1: v('yes', 'Ann'), u2: v('yes', 'Ben') }),
      opt('b', '2026-10-08', { u1: v('no', 'Ann') }),
    ]);
    expect(s.doneCount).toBe(1);          // Ann voted on both; Ben only on one
    expect(s.waiting.sort()).toEqual(['Ben', 'Cal']);
  });

  it('treats an explicit "none" as not having voted', () => {
    const s = summarizeVoting({ members: { u1: members.u1 } }, [
      opt('a', '2026-10-01', { u1: v('none', 'Ann') }),
    ]);
    expect(s.doneCount).toBe(0);
    expect(s.waiting).toEqual(['Ann']);
  });

  it('lets a plus-one ride on the person they came with', () => {
    const s = summarizeVoting({
      members: { u1: { name: 'Ann' }, u2: { name: 'Ann+1', plusOneOf: 'u1' } },
    }, [opt('a', '2026-10-01', { u1: v('yes', 'Ann') })]);
    expect(s.waiting).toEqual([]);
    expect(s.doneCount).toBe(2);
  });

  it('leaves skipVote members out of the tally entirely', () => {
    const s = summarizeVoting({
      members: { u1: { name: 'Ann' }, u2: { name: 'Baby', skipVote: true } },
    }, [opt('a', '2026-10-01', { u1: v('yes', 'Ann') })]);
    expect(s.totalVoters).toBe(1);
    expect(s.waiting).toEqual([]);
  });

  it('says so when there are no dates yet', () => {
    const s = summarizeVoting({ members }, []);
    expect(s.headline).toBe('No dates on the table yet');
    expect(s.leaderId).toBe(null);
  });

  it('switches the headline once the event is finalized', () => {
    const s = summarizeVoting({ members, stage: 'finalized' }, [opt('a', '2026-10-01', { u1: v('yes', 'Ann') })]);
    expect(s.isFinalized).toBe(true);
    expect(s.headline).toBe('The date is settled');
  });

  it('counts the people, not the votes, in the headline', () => {
    const s = summarizeVoting({ members }, [opt('a', '2026-10-01', { u1: v('yes', 'Ann') })]);
    expect(s.headline).toBe('1 of 3 people have voted on every date');
  });
});

describe('rangeLabel', () => {
  it('shows one day as one date', () => {
    expect(rangeLabel({ startDate: '2026-10-01', endDate: '2026-10-01' })).toBe('Thu, Oct 1, 2026');
  });

  it('shows a span as a range', () => {
    expect(rangeLabel({ startDate: '2026-10-01', endDate: '2026-10-04' }))
      .toBe('Thu, Oct 1, 2026 – Sun, Oct 4, 2026');
  });
});

describe('renderVotingStatusEmail', () => {
  const build = (event, options) => renderVotingStatusEmail({
    event,
    eventId: 'evt1',
    summary: summarizeVoting(event, options),
    fromName: 'Dan',
    appUrl: 'https://example.test',
  });

  it('names the event in the subject while the vote is open', () => {
    const { subject } = build({ title: 'Cabin weekend', members: {} }, []);
    expect(subject).toBe('Rally: where the vote stands on Cabin weekend');
  });

  it('changes the subject once the date is set', () => {
    const { subject } = build({ title: 'Cabin weekend', stage: 'finalized', members: {} }, []);
    expect(subject).toBe('Rally: Cabin weekend — the date is set');
  });

  it('marks the leading date and lists who is missing', () => {
    const { html } = build(
      { title: 'Cabin weekend', members: { u1: { name: 'Ann' }, u2: { name: 'Ben' } } },
      [opt('a', '2026-10-01', { u1: v('yes', 'Ann'), u2: v('yes', 'Ben') }), opt('b', '2026-10-08', { u1: v('no', 'Ann') })],
    );
    expect(html).toContain('Leading');
    expect(html).toContain('Still waiting on');
    expect(html).toContain('Ben');
  });

  it('says everyone voted rather than showing an empty waiting list', () => {
    const { html } = build(
      { title: 'Cabin weekend', members: { u1: { name: 'Ann' } } },
      [opt('a', '2026-10-01', { u1: v('yes', 'Ann') })],
    );
    expect(html).toContain('Everyone has voted');
    expect(html).not.toContain('Still waiting on');
  });

  it('links to this event\'s poll', () => {
    const { html } = build({ title: 'X', members: {} }, []);
    expect(html).toContain('https://example.test/poll/evt1');
  });

  it('escapes titles, notes and names rather than letting them inject markup', () => {
    const { html, subject } = build(
      { title: '<script>x</script>', members: { u1: { name: '<b>Ann</b>' } } },
      [opt('a', '2026-10-01', {}, { note: '<img src=x onerror=y>' })],
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    // The subject is plain text, so it carries the raw title — it must never be
    // interpolated into HTML by a caller.
    expect(subject).toContain('<script>x</script>');
  });

  it('lists reference dates separately from the ones being voted on', () => {
    const { html } = build({ title: 'X', members: {} }, [
      opt('a', '2026-10-01', {}, { noVote: true, note: 'Backup option' }),
    ]);
    expect(html).toContain('For reference');
    expect(html).toContain('Backup option');
  });

  it('handles an event with no dates without breaking', () => {
    const { html } = build({ title: 'X', members: {} }, []);
    expect(html).toContain('No dates have been suggested yet');
  });
});
