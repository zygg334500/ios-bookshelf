import { describe, expect, it } from 'vitest';
import { shelfCountLabel, summarizeImports } from './shelf';

describe('shelf batch', () => {
  it('keeps the books that imported when one file fails', () => {
    const summary = summarizeImports([
      { name: '窗下.epub', ok: true, format: 'epub' },
      { name: 'locked.azw3', ok: false, error: '此文件受数字版权保护（DRM），BookShelf 无法打开。' },
      { name: 'window-free.azw3', ok: true, format: 'azw3' },
    ]);
    expect(summary).toContain('已放入 2 本');
    expect(summary).toContain('1 本无 DRM 的 AZW3');
    expect(summary).toContain('1 本没有放上书架');
    expect(summary).toContain('受数字版权保护');
    expect(summary).not.toContain('破解');
  });

  it('counts a shelf of many books', () => {
    expect(shelfCountLabel(0)).toContain('没有书');
    expect(shelfCountLabel(12)).toContain('12 本');
  });
});
