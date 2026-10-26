/** 0..1 position across chapters. Page index is 0-based. */
export function readingProgress(
  chapterIndex: number,
  pageIndex: number,
  pageCount: number,
  chapterCount: number,
): number {
  if (chapterCount <= 0) return 0;
  const pages = Math.max(pageCount, 1);
  const within = Math.min(Math.max(pageIndex, 0), pages - 1) / pages;
  const chapter = Math.min(Math.max(chapterIndex, 0), chapterCount - 1);
  return Math.min(1, (chapter + within) / chapterCount);
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
