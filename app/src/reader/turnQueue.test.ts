import { describe, expect, it } from 'vitest';
import { durationFor, effectFor, FADE_MS, HURRY_MS, noteTap, planAfter, TAP_CURL_MS } from './turnQueue';

describe('page turn queue', () => {
  it('uses a paper curl by default and a short fade when motion is reduced', () => {
    expect(effectFor('curl', false)).toBe('curl');
    expect(effectFor(undefined, false)).toBe('curl');
    expect(effectFor('slide', false)).toBe('slide');
    expect(effectFor('none', false)).toBe('none');
    expect(effectFor('curl', true)).toBe('fade');
    expect(durationFor('fade', false)).toBeLessThanOrEqual(220);
    expect(durationFor('fade', false)).toBe(FADE_MS);
    expect(durationFor('curl', false)).toBe(TAP_CURL_MS);
    expect(durationFor('curl', true)).toBe(HURRY_MS);
    expect(TAP_CURL_MS).toBeLessThanOrEqual(200);
    expect(HURRY_MS).toBeLessThanOrEqual(120);
  });

  it('queues extra right-edge taps and snaps every page but the last', () => {
    const first = noteTap({ pending: 0, animating: false }, 1);
    expect(first.start).toBe(true);
    expect(first.hurry).toBe(false);
    const second = noteTap(first.queue, 1);
    const third = noteTap(second.queue, 1);
    const fourth = noteTap(third.queue, 1);
    expect(fourth.hurry).toBe(true);
    expect(fourth.start).toBe(false);
    expect(fourth.queue.pending).toBe(3);
    expect(planAfter(fourth.queue.pending)).toEqual({ snap: 2, dir: 1 });
    expect(planAfter(1)).toEqual({ snap: 0, dir: 1 });
    expect(planAfter(-2)).toEqual({ snap: 1, dir: -1 });
    expect(planAfter(0)).toEqual({ snap: 0, dir: 0 });
  });
});
