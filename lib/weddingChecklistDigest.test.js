// Shaping the checklist for the weekly email, and working out what moved.
import { describe, it, expect } from 'vitest';
import { checklistSummary, checklistSnapshot, checklistDelta } from './weddingChecklistDigest.js';

const LIST = {
  phases: [
    {
      id: 'now',
      title: 'Now',
      when: 'allow 1–3 months',
      tasks: [
        { id: 'venue', text: 'Book the venue', milestone: true },
        { id: 'budget', text: 'Settle the budget' },
      ],
    },
    {
      id: 'later',
      title: 'Later',
      tasks: [
        { id: 'cake', text: 'Book the cake' },
        { id: 'invites', text: 'Mail invitations', milestone: true },
      ],
    },
  ],
  done: {},
};

const ticked = (...keys) => ({ ...LIST, done: Object.fromEntries(keys.map((k) => [k, true])) });

describe('checklistSummary', () => {
  it('counts the whole list and each phase within it', () => {
    const s = checklistSummary(ticked('now.venue'));
    expect(s).toMatchObject({ total: 4, complete: 1, pct: 25, finished: false });
    expect(s.sections.map((p) => [p.title, p.complete, p.total]))
      .toEqual([['Now', 1, 2], ['Later', 0, 2]]);
  });

  it('keeps the phases in timeline order, not in order of progress', () => {
    const s = checklistSummary(ticked('later.cake', 'later.invites'));
    expect(s.sections.map((p) => p.title)).toEqual(['Now', 'Later']);
    expect(s.sections[1].finished).toBe(true);
  });

  it('marks the earliest outstanding task as next, with its phase', () => {
    expect(checklistSummary(LIST).next).toMatchObject({ text: 'Book the venue', phaseTitle: 'Now' });
    expect(checklistSummary(ticked('now.venue')).next)
      .toMatchObject({ text: 'Settle the budget', phaseTitle: 'Now' });
  });

  it('has no next task once everything is done', () => {
    const s = checklistSummary(ticked('now.venue', 'now.budget', 'later.cake', 'later.invites'));
    expect(s).toMatchObject({ next: null, finished: true, pct: 100 });
  });

  it('lists only the milestones still outstanding', () => {
    expect(checklistSummary(LIST).milestonesLeft.map((t) => t.text))
      .toEqual(['Book the venue', 'Mail invitations']);
    expect(checklistSummary(ticked('now.venue')).milestonesLeft.map((t) => t.text))
      .toEqual(['Mail invitations']);
  });

  it('flags each task with whether it is done', () => {
    const s = checklistSummary(ticked('now.budget'));
    expect(s.sections[0].tasks.map((t) => [t.text, t.done]))
      .toEqual([['Book the venue', false], ['Settle the budget', true]]);
  });

  it('is not thrown by a tick left over from a deleted task', () => {
    // normalizeChecklist prunes it; the count must not exceed the total either
    // way, or the email reads "5 of 4 done".
    const s = checklistSummary({ ...LIST, done: { 'now.venue': true, 'now.gone': true } });
    expect(s).toMatchObject({ complete: 1, total: 4 });
    expect(s.pct).toBeLessThanOrEqual(100);
  });

  it('seeds an account that has never edited a list', () => {
    expect(checklistSummary(undefined).total).toBeGreaterThan(50);
  });

  it('reports an emptied list as empty rather than reseeding it', () => {
    expect(checklistSummary({ phases: [], done: {} }))
      .toMatchObject({ total: 0, complete: 0, pct: 0, next: null, finished: false });
  });
});

describe('checklistSnapshot', () => {
  it('records which tasks are ticked, not just how many', () => {
    expect(checklistSnapshot(ticked('now.venue', 'later.cake')))
      .toEqual({ total: 4, done: ['later.cake', 'now.venue'] });
  });

  it('is stable whatever order the ticks went in', () => {
    expect(checklistSnapshot(ticked('later.cake', 'now.venue')))
      .toEqual(checklistSnapshot(ticked('now.venue', 'later.cake')));
  });
});

describe('checklistDelta', () => {
  it('says nothing on a first run rather than inventing a week', () => {
    expect(checklistDelta(LIST, null)).toBeNull();
    expect(checklistDelta(LIST, {})).toBeNull();
    expect(checklistDelta(LIST, { total: 4 })).toBeNull();
  });

  it('names what got ticked off, in timeline order', () => {
    const before = checklistSnapshot(LIST);
    const d = checklistDelta(ticked('later.cake', 'now.venue'), before);
    expect(d.ticked.map((t) => t.text)).toEqual(['Book the venue', 'Book the cake']);
    expect(d.any).toBe(true);
  });

  it('carries the phase each finished task came from', () => {
    const d = checklistDelta(ticked('later.cake'), checklistSnapshot(LIST));
    expect(d.ticked[0]).toMatchObject({ text: 'Book the cake', phaseTitle: 'Later' });
  });

  it('counts anything that came back off', () => {
    const before = checklistSnapshot(ticked('now.venue', 'now.budget'));
    const d = checklistDelta(ticked('now.venue'), before);
    expect(d).toMatchObject({ unticked: 1, any: true });
    expect(d.ticked).toEqual([]);
  });

  it('does not net a tick against an untick into "no change"', () => {
    const before = checklistSnapshot(ticked('now.venue'));
    const d = checklistDelta(ticked('now.budget'), before);
    expect(d.ticked.map((t) => t.text)).toEqual(['Settle the budget']);
    expect(d.unticked).toBe(1);
    expect(d.any).toBe(true);
  });

  it('says plainly that nothing moved', () => {
    const snap = checklistSnapshot(ticked('now.venue'));
    expect(checklistDelta(ticked('now.venue'), snap)).toMatchObject({ ticked: [], unticked: 0, any: false });
  });

  it('does not report a deleted task as unticked — it is gone, not undone', () => {
    const before = checklistSnapshot(ticked('later.cake'));
    const shorter = { phases: [LIST.phases[0]], done: {} };
    expect(checklistDelta(shorter, before)).toMatchObject({ ticked: [], unticked: 0, any: false });
  });

  it('counts tasks added since last week', () => {
    const before = checklistSnapshot(LIST);
    const bigger = {
      ...LIST,
      phases: [...LIST.phases, { id: 'x', title: 'X', tasks: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] }],
    };
    expect(checklistDelta(bigger, before).added).toBe(2);
  });
});
