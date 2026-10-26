import { describe, expect, it } from 'vitest';
import { MemoryLibrary } from './memory';
import type { BookRecord } from '../core/types';

function book(id: string, title: string): BookRecord {
  return {
    id,
    title,
    author: '样本',
    format: 'epub',
    fileName: `${title}.epub`,
    addedAt: id === 'a' ? 1 : 2,
    lastOpenedAt: null,
    chapterIndex: 0,
    pageIndex: 0,
    progress: 0,
    coverName: null,
    readingMark: 'auto',
  };
}

describe('MemoryLibrary', () => {
  it('inserts, remembers position, and deletes', async () => {
    const store = new MemoryLibrary();
    await store.insert(book('a', '甲'));
    await store.insert(book('b', '乙'));
    await store.updatePosition('b', 2, 4, 0.42);
    const listed = await store.list();
    expect(listed.map((item) => item.id)).toEqual(['b', 'a']);
    expect(listed[0].chapterIndex).toBe(2);
    expect(listed[0].pageIndex).toBe(4);
    expect(listed[0].progress).toBeCloseTo(0.42);
    await store.updateReadingMark('b', 'finished');
    expect((await store.list())[0].readingMark).toBe('finished');
    await store.setSetting('pin', '2468');
    expect(await store.getSetting('pin')).toBe('2468');
    await store.remove('b');
    expect((await store.list()).map((item) => item.id)).toEqual(['a']);
  });
});
