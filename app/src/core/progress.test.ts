import { describe, expect, it } from 'vitest';
import { readingProgress } from './progress';

describe('readingProgress', () => {
  it('is zero at the start of the first chapter', () => {
    expect(readingProgress(0, 0, 10, 4)).toBe(0);
  });

  it('advances inside a chapter and reaches 1 on the last page', () => {
    expect(readingProgress(1, 5, 10, 4)).toBeCloseTo(1.5 / 4);
    expect(readingProgress(3, 8, 10, 4)).toBeCloseTo(3.8 / 4);
    expect(readingProgress(3, 9, 10, 4)).toBe(1);
  });

  it('leaves a single page at zero so a short note is not auto-finished', () => {
    expect(readingProgress(0, 0, 1, 1)).toBe(0);
  });

  it('clamps empty books', () => {
    expect(readingProgress(0, 0, 0, 0)).toBe(0);
  });
});
