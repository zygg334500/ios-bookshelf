import { Platform } from 'react-native';
import type { ReaderTheme } from '../core/types';

export const shelf = {
  bg: '#E8E0D4',
  bgDeep: '#D5C9B8',
  card: 'rgba(255, 251, 245, 0.72)',
  cardSolid: '#F7F1E7',
  ink: '#1C1916',
  muted: '#6E645B',
  line: 'rgba(60, 40, 20, 0.12)',
  accent: '#8E3B34',
  accentInk: '#F8F1E8',
  cloth: ['#7A312C', '#1E3C4E', '#2A4A3C', '#6E4A22', '#3C3454', '#4E3228'],
};

/**
 * Native wants a single installed face. Web keeps a stack so the browser preview
 * still finds PingFang / Songti / Georgia.
 */
export const fonts = {
  display: Platform.select({
    ios: 'Songti SC',
    android: 'serif',
    default: 'Georgia, "Iowan Old Style", Palatino, "Songti SC", "Times New Roman", serif',
  }) as string,
  ui: Platform.select({
    ios: 'PingFang SC',
    android: 'sans-serif',
    default: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  }) as string,
};

export function paperColors(theme: ReaderTheme): { paper: string; ink: string; track: string; muted: string } {
  if (theme === 'dark') return { paper: '#1c1c1e', ink: '#f0ebe3', track: '#3a3836', muted: 'rgba(240,235,227,0.62)' };
  if (theme === 'light') return { paper: '#fbf9f4', ink: '#1d1d1f', track: '#e6e1d8', muted: 'rgba(29,29,31,0.55)' };
  return { paper: '#f4ecd8', ink: '#3a2f24', track: '#e0d3bc', muted: 'rgba(58,47,36,0.62)' };
}

export function clothColor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
  return shelf.cloth[hash % shelf.cloth.length];
}
