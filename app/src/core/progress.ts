/**
 * 0..1 position across chapters. Page index is 0-based.
 * The first page stays 0. The last page of a book that actually turns
 * is 1, so the shelf can mark 已完成 from progress. A one-page book stays 0
 * until the reader marks it finished.
 */
export function readingProgress(
  chapterIndex: number,
  pageIndex: number,
  pageCount: number,
  chapterCount: number,
): number {
  if (chapterCount <= 0) return 0;
  const pages = Math.max(pageCount, 1);
  const chapter = Math.min(Math.max(chapterIndex, 0), chapterCount - 1);
  const page = Math.min(Math.max(pageIndex, 0), pages - 1);
  const lastPage = chapter === chapterCount - 1 && page === pages - 1;
  if (lastPage && (chapterCount > 1 || pages > 1)) return 1;
  if (chapter === 0 && page === 0) return 0;
  return Math.min(1, (chapter + page / pages) / chapterCount);
}

export function createId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const n = Math.floor(Math.random() * 16);
    const v = ch === 'x' ? n : (n & 0x3) | 0x8;
    return v.toString(16);
  });
}
