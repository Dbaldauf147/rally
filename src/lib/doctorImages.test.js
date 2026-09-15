import { describe, it, expect, vi } from 'vitest';

vi.mock('../firebase', () => ({ db: {} }));

const { fitWithin, MAX_SIDE } = await import('./doctorImages');

describe('fitWithin', () => {
  it('shrinks the longest side to the limit and keeps the shape', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: MAX_SIDE, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: MAX_SIDE });
  });

  it('leaves a picture that already fits alone', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('never goes below one pixel for a missing or tiny size', () => {
    expect(fitWithin(0, 0)).toEqual({ width: 1, height: 1 });
    expect(fitWithin(10000, 1, 100)).toEqual({ width: 100, height: 1 });
  });
});
