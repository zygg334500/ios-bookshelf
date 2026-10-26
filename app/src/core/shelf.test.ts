import { describe, expect, it } from 'vitest';
import { filterAndSortBooks, shelfCountLabel, summarizeImports, type ShelfEntry } from './shelf';

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

  it('searches title, author, and file name, then sorts', () => {
    const books: ShelfEntry[] = [
      { title: '窗下', author: '甲', fileName: 'window.epub', addedAt: 1, progress: 0.2, lastOpenedAt: 5 },
      { title: '纸边笔记', author: '乙', fileName: 'notes.pdf', addedAt: 3, progress: 0.9, lastOpenedAt: null },
      { title: '无锁的样本', author: '甲', fileName: 'window-free.azw3', addedAt: 2, progress: 0, lastOpenedAt: 9 },
    ];
    expect(filterAndSortBooks(books, '甲', 'recent').map((book) => book.title)).toEqual(['无锁的样本', '窗下']);
    expect(filterAndSortBooks(books, '窗下', 'recent').map((book) => book.fileName)).toEqual(['window.epub']);
    expect(filterAndSortBooks(books, 'notes', 'title').map((book) => book.fileName)).toEqual(['notes.pdf']);
    expect(filterAndSortBooks(books, '', 'title').map((book) => book.title)).toEqual(['窗下', '无锁的样本', '纸边笔记']);
    expect(filterAndSortBooks(books, '', 'author').map((book) => book.title)).toEqual(['窗下', '无锁的样本', '纸边笔记']);
    expect(filterAndSortBooks(books, '', 'progress')[0]?.title).toBe('纸边笔记');
    expect(filterAndSortBooks(books, '', 'opened')[0]?.title).toBe('无锁的样本');
    expect(filterAndSortBooks(books, '没有这本书', 'recent')).toEqual([]);
  });
});
