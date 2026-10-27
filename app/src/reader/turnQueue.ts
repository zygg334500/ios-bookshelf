import type { PageTurnMode } from '../core/types';

/** Keep these durations in sync with assets/reader/engine.readerhtml. */
export const TAP_CURL_MS = 180;
export const HURRY_MS = 110;
export const SLIDE_MS = 170;
export const SLIDE_HURRY_MS = 100;
export const FADE_MS = 200;

export type TurnEffect = 'curl' | 'slide' | 'fade' | 'none';

export function effectFor(mode: PageTurnMode | undefined, reducedMotion: boolean): TurnEffect {
  if (reducedMotion) return 'fade';
  if (mode === 'none') return 'none';
  if (mode === 'slide') return 'slide';
  return 'curl';
}

export function durationFor(effect: TurnEffect, hurry: boolean): number {
  if (effect === 'none') return 0;
  if (effect === 'fade') return FADE_MS;
  if (effect === 'slide') return hurry ? SLIDE_HURRY_MS : SLIDE_MS;
  return hurry ? HURRY_MS : TAP_CURL_MS;
}

export type TurnQueue = {
  /** Net taps waiting. Positive is forward, negative is back. */
  pending: number;
  animating: boolean;
};

/**
 * A tap during an animation does not wait out the full curl.
 * It shortens the current one and remembers how many pages are still owed.
 */
export function noteTap(queue: TurnQueue, dir: 1 | -1): { queue: TurnQueue; hurry: boolean; start: boolean } {
  if (!queue.animating) {
    return { queue: { pending: 0, animating: true }, hurry: false, start: true };
  }
  return { queue: { pending: queue.pending + dir, animating: true }, hurry: true, start: false };
}

/**
 * After the current animation lands, skip the visual for every queued page
 * except the last one, so a burst of right-edge taps catches up immediately.
 */
export function planAfter(pending: number): { snap: number; dir: -1 | 0 | 1 } {
  if (!pending) return { snap: 0, dir: 0 };
  const dir: -1 | 1 = pending > 0 ? 1 : -1;
  const count = Math.abs(pending);
  if (count === 1) return { snap: 0, dir };
  return { snap: count - 1, dir };
}
