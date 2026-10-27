import {
  defaultReaderSettings,
  type PageTurnMode,
  type ReaderAlign,
  type ReaderFontId,
  type ReaderScript,
  type ReaderSettings,
  type ReaderTheme,
} from './types';

const FONTS: ReaderFontId[] = ['system', 'pingfang', 'songti', 'heiti', 'kaiti', 'yuanti'];
const THEMES: ReaderTheme[] = ['light', 'sepia', 'dark'];
const ALIGNS: ReaderAlign[] = ['left', 'justify', 'center'];
const PAGE_TURNS: PageTurnMode[] = ['curl', 'slide', 'none'];
const SCRIPTS: ReaderScript[] = ['original', 'hans', 'hant', 'classical'];

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/** Accepts the current shape and the old `{ verticalTraditional }` blob. */
export function normalizeReaderSettings(raw: unknown): ReaderSettings {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const legacyVertical = input.verticalTraditional === true;
  const fontId = FONTS.includes(input.fontId as ReaderFontId)
    ? (input.fontId as ReaderFontId)
    : defaultReaderSettings.fontId;
  const theme = THEMES.includes(input.theme as ReaderTheme)
    ? (input.theme as ReaderTheme)
    : defaultReaderSettings.theme;
  const align = ALIGNS.includes(input.align as ReaderAlign)
    ? (input.align as ReaderAlign)
    : defaultReaderSettings.align;
  const pageTurn = PAGE_TURNS.includes(input.pageTurn as PageTurnMode)
    ? (input.pageTurn as PageTurnMode)
    : defaultReaderSettings.pageTurn;
  const legacyTraditional = typeof input.traditional === 'boolean' ? input.traditional : legacyVertical;
  const script = SCRIPTS.includes(input.script as ReaderScript)
    ? (input.script as ReaderScript)
    : legacyTraditional
      ? 'hant'
      : 'original';
  return {
    fontId,
    fontSize: Math.round(clamp(input.fontSize, 14, 36, defaultReaderSettings.fontSize)),
    lineHeight: Math.round(clamp(input.lineHeight, 1.35, 2.3, defaultReaderSettings.lineHeight) * 100) / 100,
    margin: Math.round(clamp(input.margin, 8, 48, defaultReaderSettings.margin)),
    align,
    theme,
    vertical: typeof input.vertical === 'boolean' ? input.vertical : legacyVertical,
    script,
    traditional: script === 'hant' || script === 'classical',
    brightness: Math.round(clamp(input.brightness, 0.55, 1, defaultReaderSettings.brightness) * 100) / 100,
    pageTurn,
  };
}

export type ReaderPrefs = {
  global: ReaderSettings;
  books: Record<string, ReaderSettings>;
};

export function parseReaderPrefs(raw: string | null): ReaderPrefs {
  if (!raw) return { global: { ...defaultReaderSettings }, books: {} };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return { global: { ...defaultReaderSettings }, books: {} };
    const record = parsed as Record<string, unknown>;
    if (record.global && typeof record.global === 'object') {
      const booksRaw = record.books && typeof record.books === 'object' ? (record.books as Record<string, unknown>) : {};
      const books: Record<string, ReaderSettings> = {};
      for (const [id, value] of Object.entries(booksRaw)) {
        if (value && typeof value === 'object') books[id] = normalizeReaderSettings(value);
      }
      return { global: normalizeReaderSettings(record.global), books };
    }
    return { global: normalizeReaderSettings(record), books: {} };
  } catch {
    return { global: { ...defaultReaderSettings }, books: {} };
  }
}

export function settingsForBook(prefs: ReaderPrefs, bookId: string): ReaderSettings {
  return prefs.books[bookId] ?? prefs.global;
}
