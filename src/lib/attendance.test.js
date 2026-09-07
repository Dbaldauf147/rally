import { describe, it, expect } from 'vitest';
import { buildVoteStats, isYesMaybe } from './attendance';

describe('buildVoteStats', () => {
  it('counts each vote by person', () => {
    const stats = buildVoteStats([
      { votes: { amy: { vote: 'yes' }, ben: { vote: 'no' } } },
      { votes: { amy: { vote: 'maybe' }, ben: { vote: 'no' } } },
    ]);
    expect(stats.amy).toEqual({ total: 2, yes: 1, maybe: 1, no: 0 });
    expect(stats.ben).toEqual({ total: 2, yes: 0, maybe: 0, no: 2 });
  });

  it('ignores closed, reference-only and empty votes', () => {
    const stats = buildVoteStats([
      { closed: true, votes: { amy: { vote: 'yes' } } },
      { noVote: true, votes: { ben: { vote: 'yes' } } },
      { votes: { cara: { vote: 'none' } } },
    ]);
    expect(stats).toEqual({});
  });
});

describe('isYesMaybe', () => {
  const members = { amy: { name: 'Amy' }, ben: { name: 'Ben' }, dan: { name: 'Dan', plusOneOf: 'amy' } };

  it('counts a yes and a maybe, not a no', () => {
    const stats = { amy: { yes: 1, maybe: 0 }, ben: { yes: 0, maybe: 1 }, cara: { yes: 0, maybe: 0, no: 2 } };
    expect(isYesMaybe('amy', members.amy, members, stats)).toBe(true);
    expect(isYesMaybe('ben', members.ben, members, stats)).toBe(true);
    expect(isYesMaybe('cara', { name: 'Cara' }, members, stats)).toBe(false);
  });

  it('leaves out someone who has not voted at all', () => {
    expect(isYesMaybe('amy', members.amy, members, {})).toBe(false);
  });

  it('lets a manual Going or Not going override the votes', () => {
    const stats = { amy: { yes: 1, maybe: 0 } };
    expect(isYesMaybe('amy', { ...members.amy, attendance: 'notgoing' }, members, stats)).toBe(false);
    expect(isYesMaybe('cara', { name: 'Cara', attendance: 'going' }, members, {})).toBe(true);
  });

  it('carries a linked +1 in on their partner’s vote, both ways round', () => {
    const stats = { amy: { yes: 1, maybe: 0 } };
    expect(isYesMaybe('dan', members.dan, members, stats)).toBe(true);
    // And the other way: Dan votes, Amy points at nobody but is pointed at.
    expect(isYesMaybe('amy', members.amy, members, { dan: { yes: 1, maybe: 0 } })).toBe(true);
  });

  /* The rule: an actual vote always beats one assumed by way of a partner.
     Eric votes no on every date and is linked to Katie, who votes yes on every
     date. He answered; his answer stands. Before this he was counted as coming,
     shown as a likely attendee, offered a meal and put on the expense split. */
  it('does not let a partner’s yes override an explicit no', () => {
    const linked = { eric: { name: 'Eric', plusOneOf: 'katie' }, katie: { name: 'Katie' } };
    const stats = { eric: { total: 3, yes: 0, maybe: 0, no: 3 }, katie: { total: 3, yes: 3, maybe: 0, no: 0 } };
    expect(isYesMaybe('eric', linked.eric, linked, stats)).toBe(false);
    expect(isYesMaybe('katie', linked.katie, linked, stats)).toBe(true);
  });

  it('overrides nothing when they have not voted at all', () => {
    const linked = { dee: { name: 'Dee', plusOneOf: 'al' }, al: { name: 'Al' } };
    const stats = { al: { total: 2, yes: 2, maybe: 0, no: 0 } };
    expect(isYesMaybe('dee', linked.dee, linked, stats)).toBe(true);
  });

  it('still lets a manual Going override an explicit no', () => {
    const stats = { eric: { total: 3, yes: 0, maybe: 0, no: 3 } };
    expect(isYesMaybe('eric', { name: 'Eric', attendance: 'going' }, {}, stats)).toBe(true);
  });

  it('leaves skipVote members out', () => {
    expect(isYesMaybe('amy', { ...members.amy, skipVote: true }, members, { amy: { yes: 1 } })).toBe(false);
  });
});
