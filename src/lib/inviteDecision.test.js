import { describe, it, expect } from 'vitest';
import { START, QUESTIONS, OUTCOMES, walk, progress, remainingDepth, questionNumber, isQuestion, isOutcome } from './inviteDecision';

const Y = true;
const N = false;

describe('invite decision tree', () => {
  it('starts on question 1', () => {
    expect(START).toBe('q1');
    expect(walk([]).node).toBe('q1');
    expect(questionNumber([])).toBe(1);
  });

  it.each([
    [[Y, Y], 'invite'],
    [[Y, N, Y], 'invite'],
    [[Y, N, N], 'discuss'],
    [[N, Y], 'skip'],
    [[N, N, Y], 'discuss'],
    [[N, N, N], 'skip'],
  ])('answers %j end on %s', (answers, outcome) => {
    expect(walk(answers).node).toBe(outcome);
    expect(isOutcome(outcome)).toBe(true);
    expect(progress(answers)).toBe(1);
  });

  it('routes YES on q1 to q2 and NO to q4', () => {
    expect(walk([Y]).node).toBe('q2');
    expect(walk([N]).node).toBe('q4');
    expect(walk([Y, N]).node).toBe('q3');
    expect(walk([N, N]).node).toBe('q5');
  });

  it('records the path it took', () => {
    expect(walk([N, N, Y]).steps).toEqual([
      { id: 'q1', yes: false },
      { id: 'q4', yes: false },
      { id: 'q5', yes: true },
    ]);
  });

  it('ignores answers past an outcome', () => {
    expect(walk([Y, Y, N, N]).node).toBe('invite');
    expect(walk([Y, Y, N, N]).steps).toHaveLength(2);
  });

  it('never goes more than three questions deep', () => {
    expect(remainingDepth('q1')).toBe(3);
    expect(remainingDepth('q2')).toBe(2);
    expect(remainingDepth('q5')).toBe(1);
    expect(remainingDepth('invite')).toBe(0);
  });

  it('moves the progress bar forward on every answer', () => {
    expect(progress([])).toBe(0);
    expect(progress([Y])).toBeCloseTo(1 / 3);
    expect(progress([Y, N])).toBeCloseTo(2 / 3);
  });

  it('only points at questions and outcomes that exist', () => {
    for (const q of Object.values(QUESTIONS)) {
      for (const next of [q.yes, q.no]) expect(isQuestion(next) || isOutcome(next)).toBe(true);
    }
    expect(Object.keys(OUTCOMES).sort()).toEqual(['discuss', 'invite', 'skip']);
  });
});
