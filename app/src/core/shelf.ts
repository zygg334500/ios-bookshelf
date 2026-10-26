import type { ReadingMark } from './types';

export type ImportAttempt = {
  name: string;
  ok: boolean;
  format?: string;
  error?: string;
};

/** Chinese summary for a batch of imports. One failure does not hide the books that landed. */
export function summarizeImports(attempts: ImportAttempt[]): string {
  const placed = attempts.filter((item) => item.ok);
  const failed = attempts.filter((item) => !item.ok);
  if (placed.length === 0 && failed.length === 0) return '没有选择文件。';
  const parts: string[] = [];
  if (placed.length > 0) {
    const azw3 = placed.filter((item) => item.format === 'azw3').length;
    parts.push(`已放入 ${placed.length} 本。`);
    if (azw3 > 0) parts.push(`其中 ${azw3} 本无 DRM 的 AZW3 可以打开阅读。`);
  }
  if (failed.length > 0) {
    const detail = failed.map((item) => `《${item.name}》：${item.error || '导入失败。'}`).join(' ');
    parts.push(`${failed.length} 本没有放上书架。${detail}`);
  }
  return parts.join('');
}

export function shelfCountLabel(count: number): string {
  if (count <= 0) return '架上还没有书。';
  return `架上 ${count} 本。点封面打开，点「移出」再点一次确认拿走。`;
}

export type ShelfSort = 'recent' | 'title' | 'author' | 'progress' | 'opened';

export type { ReadingMark };
export type ReadingStatus = 'unread' | 'reading' | 'finished';
export type ShelfFilter = 'all' | ReadingStatus;

/** Last-page progress is 1. Anything this close still counts as finished. */
export const FINISHED_PROGRESS = 0.98;

export type ShelfEntry = {
  title: string;
  author: string;
  fileName: string;
  addedAt: number;
  progress: number;
  lastOpenedAt: number | null;
  readingMark?: ReadingMark;
};

export function normalizeReadingMark(value: unknown): ReadingMark {
  if (value === 'reading' || value === 'finished') return value;
  return 'auto';
}

/** 未读 until the book is opened. 已完成 at the end, or when the reader marks it. 标为在读 sticks. */
export function readingStatus(book: Pick<ShelfEntry, 'progress' | 'lastOpenedAt' | 'readingMark'>): ReadingStatus {
  const mark = normalizeReadingMark(book.readingMark);
  if (mark === 'finished') return 'finished';
  if (mark === 'reading') return 'reading';
  if (book.progress >= FINISHED_PROGRESS) return 'finished';
  if (book.progress <= 0.005 && !(book.lastOpenedAt && book.lastOpenedAt > 0)) return 'unread';
  return 'reading';
}

export function readingStatusLabel(status: ReadingStatus): string {
  if (status === 'finished') return '已完成';
  if (status === 'reading') return '阅读中';
  return '未读';
}

export function statusCounts<T extends ShelfEntry>(books: T[]): Record<ReadingStatus, number> {
  const counts: Record<ReadingStatus, number> = { unread: 0, reading: 0, finished: 0 };
  for (const book of books) counts[readingStatus(book)] += 1;
  return counts;
}

export function statusSummary(counts: Record<ReadingStatus, number>): string {
  return `未读 ${counts.unread} · 阅读中 ${counts.reading} · 已完成 ${counts.finished}`;
}

export function filterAndSortBooks<T extends ShelfEntry>(
  books: T[],
  query: string,
  sort: ShelfSort,
  status: ShelfFilter = 'all',
): T[] {
  const needle = query.trim().toLocaleLowerCase();
  const matched = needle
    ? books.filter((book) => `${book.title}\n${book.author}\n${book.fileName}`.toLocaleLowerCase().includes(needle))
    : books.slice();
  const filtered = status === 'all' ? matched : matched.filter((book) => readingStatus(book) === status);
  const copy = filtered.slice();
  copy.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title, 'zh') || b.addedAt - a.addedAt;
    if (sort === 'author') return a.author.localeCompare(b.author, 'zh') || a.title.localeCompare(b.title, 'zh');
    if (sort === 'progress') return b.progress - a.progress || b.addedAt - a.addedAt;
    if (sort === 'opened') return (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || b.addedAt - a.addedAt;
    return b.addedAt - a.addedAt;
  });
  return copy;
}
