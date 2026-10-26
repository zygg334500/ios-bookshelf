import { describe, expect, it } from 'vitest';
import { defaultReaderSettings } from './types';
import { normalizeReaderSettings, parseReaderPrefs, settingsForBook } from './settings';

describe('reader settings', () => {
  it('turns the old vertical-traditional switch into two flags', () => {
    const settings = normalizeReaderSettings({ verticalTraditional: true, fontSize: 18 });
    expect(settings.vertical).toBe(true);
    expect(settings.traditional).toBe(true);
    expect(settings.fontSize).toBe(18);
    expect(settings.lineHeight).toBe(defaultReaderSettings.lineHeight);
  });

  it('keeps an explicit vertical flag when the legacy switch is also set', () => {
    const settings = normalizeReaderSettings({ vertical: false, traditional: true, verticalTraditional: true });
    expect(settings.vertical).toBe(false);
    expect(settings.traditional).toBe(true);
  });

  it('clamps type size, line height, margin, and brightness', () => {
    const settings = normalizeReaderSettings({
      fontId: 'nope',
      fontSize: 80,
      lineHeight: 0.2,
      margin: 2,
      align: 'sideways',
      theme: 'neon',
      brightness: 4,
    });
    expect(settings.fontId).toBe('system');
    expect(settings.fontSize).toBe(36);
    expect(settings.lineHeight).toBe(1.35);
    expect(settings.margin).toBe(8);
    expect(settings.align).toBe('justify');
    expect(settings.theme).toBe('sepia');
    expect(settings.brightness).toBe(1);
  });

  it('reads a global blob and per-book overrides', () => {
    const prefs = parseReaderPrefs(
      JSON.stringify({
        global: { fontSize: 22, fontId: 'songti' },
        books: { a: { fontSize: 16, vertical: true, traditional: false } },
      }),
    );
    expect(settingsForBook(prefs, 'missing').fontSize).toBe(22);
    expect(settingsForBook(prefs, 'missing').fontId).toBe('songti');
    expect(settingsForBook(prefs, 'a')).toMatchObject({ fontSize: 16, vertical: true, traditional: false });
  });

  it('treats a flat settings object from older builds as the global preset', () => {
    const prefs = parseReaderPrefs(JSON.stringify({ fontId: 'kaiti', verticalTraditional: true }));
    expect(prefs.books).toEqual({});
    expect(prefs.global.fontId).toBe('kaiti');
    expect(prefs.global.vertical).toBe(true);
  });
});
