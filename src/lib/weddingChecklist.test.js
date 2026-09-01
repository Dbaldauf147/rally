import { describe, it, expect } from 'vitest';
import {
  SEED_PHASES, normalizeChecklist, seedChecklist, allTasks, totalTasks,
  toggleTask, isDone, phaseProgress, overallProgress, nextUp,
  addTask, updateTask, removeTask, moveTask,
  addPhase, updatePhase, removePhase, movePhase, restoreSeed,
} from './weddingChecklist';

const seed = () => seedChecklist();
const ids = (list) => list.phases.map((p) => p.id);
const taskIds = (list, phaseId) => list.phases.find((p) => p.id === phaseId).tasks.map((t) => t.id);

describe('the seed list', () => {
  it('runs the phases in timeline order', () => {
    expect(SEED_PHASES.map((p) => p.id))
      .toEqual(['now', 'm12', 'm10', 'm8', 'm6', 'm3', 'm2', 'm1', 'week']);
  });

  it('has 63 tasks, each with a key unique across the whole list', () => {
    const keys = allTasks(seed().phases).map((t) => t.key);
    expect(keys).toHaveLength(63);
    expect(new Set(keys).size).toBe(63);
    expect(totalTasks(seed().phases)).toBe(63);
  });

  it('marks the three milestones everything else hangs off', () => {
    expect(allTasks(seed().phases).filter((t) => t.milestone).map((t) => t.key))
      .toEqual(['now.book-venue', 'm3.mail-invitations', 'm1.license']);
  });

  it('keeps the guidance beside the task rather than inside it', () => {
    const venue = allTasks(seed().phases).find((t) => t.key === 'now.book-venue');
    expect(venue.text).toBe('Book the venue. Your date is now set.');
    expect(venue.note).toBe('Everything below counts backward from it.');
  });
});

describe('normalizeChecklist', () => {
  it('gives the seed to an account that has never edited a list', () => {
    expect(ids(normalizeChecklist({}))).toEqual(SEED_PHASES.map((p) => p.id));
  });

  it('reads back an account that only ever stored ticks', () => {
    // The shape written before the list was editable: ticks and nothing else.
    const migrated = normalizeChecklist({ done: { 'now.numbers': true, 'm1.license': true } });
    expect(totalTasks(migrated.phases)).toBe(63);
    expect(migrated.done).toEqual({ 'now.numbers': true, 'm1.license': true });
  });

  it('respects a deliberately emptied list rather than re-seeding it', () => {
    expect(normalizeChecklist({ phases: [] }).phases).toEqual([]);
  });

  it('drops a tick for a task that no longer exists', () => {
    expect(normalizeChecklist({ done: { 'now.numbers': true, 'now.gone': true } }).done)
      .toEqual({ 'now.numbers': true });
  });

  it('fills in what a stored phase or task is missing', () => {
    const l = normalizeChecklist({ phases: [{ id: 'p', title: 'P', tasks: [{ id: 't' }] }] });
    expect(l.phases[0]).toMatchObject({ when: '', tasks: [{ id: 't', text: '', note: '', milestone: false }] });
  });

  it('survives a malformed document', () => {
    expect(normalizeChecklist(undefined).phases.length).toBe(9);
    expect(normalizeChecklist({ phases: 'nope', done: 'nope' }).phases.length).toBe(9);
  });
});

describe('ticking', () => {
  it('ticks and unticks', () => {
    const once = toggleTask(seed(), 'now.numbers');
    expect(isDone(once.done, 'now.numbers')).toBe(true);
    expect(isDone(toggleTask(once, 'now.numbers').done, 'now.numbers')).toBe(false);
  });

  it('refuses to tick something that is not on the list', () => {
    expect(toggleTask(seed(), 'not.a.task').done).toEqual({});
  });

  it('does not mutate what it was given', () => {
    const before = seed();
    toggleTask(before, 'now.numbers');
    expect(before.done).toEqual({});
  });

  it('counts a phase, and the whole list as a percentage', () => {
    const list = toggleTask(seed(), 'now.numbers');
    expect(phaseProgress(list.phases[0], list.done)).toMatchObject({ complete: 1, total: 7, finished: false });
    expect(overallProgress(list)).toMatchObject({ complete: 1, total: 63 });
  });

  it('names the earliest outstanding task', () => {
    expect(nextUp(seed()).key).toBe('now.numbers');
    expect(nextUp(toggleTask(seed(), 'now.numbers')).key).toBe('now.vision');
  });
});

describe('editing tasks', () => {
  it('adds a task to the end of a phase', () => {
    const l = addTask(seed(), 'now', { text: 'Book a marquee' });
    expect(taskIds(l, 'now')).toHaveLength(8);
    expect(l.phases[0].tasks[7].text).toBe('Book a marquee');
  });

  it('gives an added task an id of its own', () => {
    const l = addTask(seed(), 'now', { text: 'A' });
    const added = l.phases[0].tasks[7];
    expect(added.id).toBeTruthy();
    expect(taskIds(l, 'now').filter((id) => id === added.id)).toHaveLength(1);
  });

  it('ignores an add to a phase that is not there', () => {
    expect(totalTasks(addTask(seed(), 'nope', { text: 'A' }).phases)).toBe(63);
  });

  it('rewording a task keeps its tick', () => {
    const ticked = toggleTask(seed(), 'now.numbers');
    const l = updateTask(ticked, 'now', 'numbers', { text: 'Settle budget, guests and season' });
    expect(l.phases[0].tasks[0].text).toBe('Settle budget, guests and season');
    expect(isDone(l.done, 'now.numbers')).toBe(true);
  });

  it('cannot be talked into changing a task id', () => {
    const l = updateTask(seed(), 'now', 'numbers', { id: 'something-else', text: 'X' });
    expect(taskIds(l, 'now')[0]).toBe('numbers');
  });

  it('edits the note and the milestone flag', () => {
    const l = updateTask(seed(), 'now', 'insurance', { note: 'Ask the venue', milestone: true });
    const t = l.phases[0].tasks.find((x) => x.id === 'insurance');
    expect(t).toMatchObject({ note: 'Ask the venue', milestone: true });
  });

  it('deleting a task takes its tick with it', () => {
    const ticked = toggleTask(seed(), 'now.numbers');
    const l = removeTask(ticked, 'now', 'numbers');
    expect(taskIds(l, 'now')).not.toContain('numbers');
    expect(l.done).toEqual({});
    expect(overallProgress(l)).toMatchObject({ complete: 0, total: 62 });
  });

  it('reorders a task, and does nothing at either end', () => {
    expect(taskIds(moveTask(seed(), 'now', 'vision', -1), 'now').slice(0, 2)).toEqual(['vision', 'numbers']);
    expect(taskIds(moveTask(seed(), 'now', 'numbers', -1), 'now')[0]).toBe('numbers');
    expect(taskIds(moveTask(seed(), 'now', 'admin', 1), 'now').at(-1)).toBe('admin');
  });
});

describe('editing phases', () => {
  it('adds a phase at the end', () => {
    const l = addPhase(seed(), { title: 'After' });
    expect(l.phases).toHaveLength(10);
    expect(l.phases[9].title).toBe('After');
  });

  it('renames a phase and its timing without touching its tasks', () => {
    const l = updatePhase(seed(), 'now', { title: 'Right now', when: 'this month' });
    expect(l.phases[0]).toMatchObject({ id: 'now', title: 'Right now', when: 'this month' });
    expect(l.phases[0].tasks).toHaveLength(7);
  });

  it('deleting a phase takes its tasks and their ticks', () => {
    const ticked = toggleTask(seed(), 'now.numbers');
    const l = removePhase(ticked, 'now');
    expect(ids(l)).not.toContain('now');
    expect(l.done).toEqual({});
    expect(totalTasks(l.phases)).toBe(56);
  });

  it('reorders a phase, and does nothing at either end', () => {
    expect(ids(movePhase(seed(), 'm12', -1)).slice(0, 2)).toEqual(['m12', 'now']);
    expect(ids(movePhase(seed(), 'now', -1))[0]).toBe('now');
    expect(ids(movePhase(seed(), 'week', 1)).at(-1)).toBe('week');
  });
});

describe('restoreSeed', () => {
  it('puts the built-in list back after it has been hacked about', () => {
    const wrecked = removePhase(removeTask(seed(), 'now', 'numbers'), 'week');
    expect(totalTasks(restoreSeed(wrecked).phases)).toBe(63);
    expect(ids(restoreSeed(wrecked))).toEqual(SEED_PHASES.map((p) => p.id));
  });

  it('keeps the ticks that still land on a task', () => {
    const ticked = toggleTask(toggleTask(seed(), 'now.numbers'), 'week.rings');
    const restored = restoreSeed(removePhase(ticked, 'week'));
    expect(isDone(restored.done, 'now.numbers')).toBe(true);
    // The tick on the deleted phase was pruned when it went, and restoring the
    // list does not resurrect it.
    expect(isDone(restored.done, 'week.rings')).toBe(false);
  });
});
