import { describe, expect, it } from 'vitest';
import { forgetBookmarks, parseBookmarks, toggleBookmark } from './bookmarks';

describe('bookmarks', () => {
  it('toggles the same page off and keeps the progress for later', () => {
    const first = toggleBookmark({}, 'book', {
      id: 'a',
      chapterIndex: 1,
      pageIndex: 3,
      progress: 0.42,
      label: '窗下',
      createdAt: 10,
    });
    expect(first.added).toBe(true);
    expect(first.all.book[0].progress).toBe(0.42);
    const second = toggleBookmark(first.all, 'book', {
      chapterIndex: 1,
      pageIndex: 3,
      progress: 0.42,
      label: '窗下',
    });
    expect(second.added).toBe(false);
    expect(second.all.book).toBeUndefined();
  });

  it('drops a book when it leaves the shelf', () => {
    const stored = parseBookmarks(JSON.stringify({ book: [{ id: 'a', chapterIndex: 0, pageIndex: 0, progress: 0, label: '开头', createdAt: 1 }], junk: 'no' }));
    expect(forgetBookmarks(stored, 'book')).toEqual({});
  });
});
