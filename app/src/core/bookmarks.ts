export type Bookmark = {
  id: string;
  chapterIndex: number;
  pageIndex: number;
  progress: number;
  label: string;
  createdAt: number;
};

const MAX_PER_BOOK = 40;

function isBookmark(value: unknown): value is Bookmark {
  if (!value || typeof value !== 'object') return false;
  const mark = value as Partial<Bookmark>;
  return (
    typeof mark.id === 'string' &&
    typeof mark.chapterIndex === 'number' &&
    typeof mark.pageIndex === 'number' &&
    typeof mark.progress === 'number' &&
    typeof mark.label === 'string' &&
    typeof mark.createdAt === 'number'
  );
}

export function parseBookmarks(raw: string | null): Record<string, Bookmark[]> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const next: Record<string, Bookmark[]> = {};
    for (const [bookId, marks] of Object.entries(parsed)) {
      if (!Array.isArray(marks)) continue;
      const clean = marks.filter(isBookmark).slice(0, MAX_PER_BOOK);
      if (clean.length) next[bookId] = clean;
    }
    return next;
  } catch {
    return {};
  }
}

export function toggleBookmark(
  all: Record<string, Bookmark[]>,
  bookId: string,
  draft: Omit<Bookmark, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
): { all: Record<string, Bookmark[]>; added: boolean } {
  const current = all[bookId] ?? [];
  const existing = current.find(
    (mark) => mark.chapterIndex === draft.chapterIndex && mark.pageIndex === draft.pageIndex,
  );
  if (existing) {
    const rest = current.filter((mark) => mark !== existing);
    const next = { ...all };
    if (rest.length) next[bookId] = rest;
    else delete next[bookId];
    return { all: next, added: false };
  }
  const mark: Bookmark = {
    id: draft.id ?? `${bookId}-${draft.chapterIndex}-${draft.pageIndex}-${draft.progress}`,
    chapterIndex: draft.chapterIndex,
    pageIndex: draft.pageIndex,
    progress: Math.max(0, Math.min(1, draft.progress)),
    label: draft.label.trim() || '书签',
    createdAt: draft.createdAt ?? Date.now(),
  };
  return {
    all: { ...all, [bookId]: [mark, ...current].slice(0, MAX_PER_BOOK) },
    added: true,
  };
}

export function forgetBookmarks(all: Record<string, Bookmark[]>, bookId: string): Record<string, Bookmark[]> {
  if (!all[bookId]) return all;
  const next = { ...all };
  delete next[bookId];
  return next;
}
