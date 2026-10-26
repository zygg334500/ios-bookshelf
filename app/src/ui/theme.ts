import type { ReaderTheme } from '../core/types';

export const shelf = {
  bg: '#E6DDD0',
  bgDeep: '#D7CBBA',
  card: '#F7F1E7',
  ink: '#1E1A16',
  muted: '#6F6256',
  line: '#CDBFAE',
  accent: '#8E2F2A',
  accentInk: '#F8F1E8',
  cloth: ['#7A312C', '#1E3C4E', '#2A4A3C', '#6E4A22', '#3C3454', '#4E3228'],
};

export const fonts = {
  display: 'Georgia, "Iowan Old Style", Palatino, "Songti SC", "Times New Roman", serif',
  ui: '-apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
};

export function paperColors(theme: ReaderTheme): { paper: string; ink: string; track: string } {
  if (theme === 'dark') return { paper: '#1c1a17', ink: '#ece4d6', track: '#3a342c' };
  if (theme === 'light') return { paper: '#fbfbf8', ink: '#1c1c1c', track: '#ddd4c6' };
  return { paper: '#f4ecd8', ink: '#3a2f24', track: '#e0d3bc' };
}

export function clothColor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
  return shelf.cloth[hash % shelf.cloth.length];
}
