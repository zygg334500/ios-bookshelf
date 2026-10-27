import type { EdgeInsets } from 'react-native-safe-area-context';

/**
 * iPhone 16e is 390×844 pt.
 * Portrait safe area from UIKit: top 59 (Dynamic Island), bottom 34 (home indicator), sides 0.
 * Landscape: bottom about 21, and about 59 on the island side.
 * Screens add a few points of comfort on top of those insets. They do not add a second
 * full inset, which previously pushed the top bar too far below the island.
 *
 * Reader text clearance (also in engine.readerhtml as --chrome-top / --chrome-bottom)
 * stays put when the bars hide, so the page does not reflow. The glass sits in that
 * margin instead of on top of the glyphs.
 */
export const READER_CHROME_TOP = 46;
export const READER_CHROME_BOTTOM = 72;

export function topChromePadding(insets: EdgeInsets): number {
  return insets.top + 2;
}

export function bottomChromePadding(insets: EdgeInsets): number {
  return insets.bottom + 6;
}

export function shelfContentPadding(insets: EdgeInsets) {
  return {
    paddingTop: insets.top + 8,
    paddingBottom: insets.bottom + 16,
    paddingLeft: Math.max(insets.left, 16),
    paddingRight: Math.max(insets.right, 16),
  };
}
