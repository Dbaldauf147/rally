import { describe, it, expect } from 'vitest';
import {
  PHASES, ALL_TASKS, TOTAL_TASKS, taskKey, normalizeDone, toggleTask, isDone,
  phaseProgress, overallProgress, nextUp, firstUnfinishedPhase,
} from './weddingChecklist';

describe('the list itself', () => {
  it('runs the phases in timeline order', () => {
    expect(PHASES.map((p) => p.id))
      .toEqual(['now', 'm12', 'm10', 'm8', 'm6', 'm3', 'm2', 'm1', 'week']);
  });

  it('gives every task a key that is unique across the whole list', () => {
    const keys = ALL_TASKS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(TOTAL_TASKS);
  });

  it('scopes keys to their phase, so two phases can share a task id', () => {
    expect(taskKey('m1', 'fitting-final')).toBe('m1.fitting-final');
    expect(ALL_TASKS.find((t) => t.key === 'now.book-venue').phaseId).toBe('now');
  });

  it('gives every task some text', () => {
    expect(ALL_TASKS.every((t) => typeof t.text === 'string' && t.text.trim())).toBe(true);
  });

  it('marks the three milestones everything else hangs off', () => {
    expect(ALL_TASKS.filter((t) => t.milestone).map((t) => t.key))
      .toEqual(['now.book-venue', 'm3.mail-invitations', 'm1.license']);
  });

  it('keeps the guidance beside the task rather than inside it', () => {
    const venue = ALL_TASKS.find((t) => t.key === 'now.book-venue');
    expect(venue.text).toBe('Book the venue. Your date is now set.');
    expect(venue.note).toBe('Everything below counts backward from it.');
  });
});

describe('normalizeDone', () => {
  it('keeps a tick against a real task', () => {
    expect(normalizeDone({ 'now.numbers': true })).toEqual({ 'now.numbers': true });
  });

  it('drops a tick for a task that no longer exists', () => {
    expect(normalizeDone({ 'now.numbers': true, 'now.gone': true })).toEqual({ 'now.numbers': true });
  });

  it('drops a falsy tick rather than storing it', () => {
    expect(normalizeDone({ 'now.numbers': false })).toEqual({});
  });

  it('survives a missing or malformed document', () => {
    expect(normalizeDone(undefined)).toEqual({});
    expect(normalizeDone('nope')).toEqual({});
  });
});

describe('toggleTask', () => {
  it('ticks and unticks', () => {
    const once = toggleTask({}, 'now.numbers');
    expect(isDone(once, 'now.numbers')).toBe(true);
    expect(isDone(toggleTask(once, 'now.numbers'), 'now.numbers')).toBe(false);
  });

  it('refuses to tick something that is not on the list', () => {
    expect(toggleTask({}, 'not.a.task')).toEqual({});
  });

  it('leaves the other ticks alone', () => {
    const done = toggleTask(toggleTask({}, 'now.numbers'), 'week.rings');
    expect(Object.keys(done).sort()).toEqual(['now.numbers', 'week.rings']);
  });

  it('does not mutate what it was given', () => {
    const before = { 'now.numbers': true };
    toggleTask(before, 'week.rings');
    expect(before).toEqual({ 'now.numbers': true });
  });
});

describe('progress', () => {
  const finishPhase = (phase) => Object.fromEntries(phase.tasks.map((t) => [taskKey(phase.id, t.id), true]));

  it('counts a phase', () => {
    const now = PHASES[0];
    const done = { [taskKey('now', 'numbers')]: true };
    expect(phaseProgress(now, done)).toMatchObject({ complete: 1, total: now.tasks.length, finished: false });
  });

  it('knows when a phase is finished', () => {
    expect(phaseProgress(PHASES[0], finishPhase(PHASES[0])).finished).toBe(true);
  });

  it('counts the whole list as a percentage', () => {
    expect(overallProgress({})).toEqual({ complete: 0, total: TOTAL_TASKS, pct: 0 });
    const all = Object.fromEntries(ALL_TASKS.map((t) => [t.key, true]));
    expect(overallProgress(all)).toMatchObject({ complete: TOTAL_TASKS, pct: 100 });
  });

  it('ignores a stale tick when counting, so the total can’t overshoot', () => {
    expect(overallProgress({ 'now.gone': true }).complete).toBe(0);
  });
});

describe('nextUp', () => {
  it('starts at the very first task', () => {
    expect(nextUp({}).key).toBe('now.numbers');
  });

  it('moves to the next outstanding task in timeline order', () => {
    expect(nextUp({ 'now.numbers': true }).key).toBe('now.vision');
  });

  it('crosses into the next phase once one is finished', () => {
    const done = Object.fromEntries(PHASES[0].tasks.map((t) => [taskKey('now', t.id), true]));
    expect(nextUp(done).phaseId).toBe('m12');
  });

  it('returns nothing once everything is done', () => {
    expect(nextUp(Object.fromEntries(ALL_TASKS.map((t) => [t.key, true])))).toBeNull();
  });
});

describe('firstUnfinishedPhase', () => {
  it('is the opening phase on a fresh list', () => {
    expect(firstUnfinishedPhase({})).toBe('now');
  });

  it('skips a phase that is fully done', () => {
    const done = Object.fromEntries(PHASES[0].tasks.map((t) => [taskKey('now', t.id), true]));
    expect(firstUnfinishedPhase(done)).toBe('m12');
  });

  it('is nothing at all once the list is complete', () => {
    expect(firstUnfinishedPhase(Object.fromEntries(ALL_TASKS.map((t) => [t.key, true])))).toBeNull();
  });
});
