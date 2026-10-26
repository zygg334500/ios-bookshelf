import { normalizeReadingMark } from '../core/shelf';
import type { BookRecord, ReadingMark } from '../core/types';

export type LibraryStore = {
  list(): Promise<BookRecord[]>;
  insert(book: BookRecord): Promise<void>;
  remove(id: string): Promise<void>;
  updatePosition(id: string, chapterIndex: number, pageIndex: number, progress: number): Promise<void>;
  updateReadingMark(id: string, mark: ReadingMark): Promise<void>;
  touch(id: string): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
};

export class MemoryLibrary implements LibraryStore {
  books: BookRecord[] = [];
  settings = new Map<string, string>();

  async list(): Promise<BookRecord[]> {
    return [...this.books]
      .map((book) => ({ ...book, readingMark: normalizeReadingMark(book.readingMark) }))
      .sort((a, b) => b.addedAt - a.addedAt);
  }

  async insert(book: BookRecord): Promise<void> {
    this.books = this.books.filter((item) => item.id !== book.id);
    this.books.push({ ...book, readingMark: normalizeReadingMark(book.readingMark) });
  }

  async remove(id: string): Promise<void> {
    this.books = this.books.filter((item) => item.id !== id);
  }

  async updatePosition(id: string, chapterIndex: number, pageIndex: number, progress: number): Promise<void> {
    const book = this.books.find((item) => item.id === id);
    if (!book) return;
    book.chapterIndex = chapterIndex;
    book.pageIndex = pageIndex;
    book.progress = progress;
    book.lastOpenedAt = Date.now();
  }

  async updateReadingMark(id: string, mark: ReadingMark): Promise<void> {
    const book = this.books.find((item) => item.id === id);
    if (!book) return;
    book.readingMark = normalizeReadingMark(mark);
  }

  async touch(id: string): Promise<void> {
    const book = this.books.find((item) => item.id === id);
    if (book) book.lastOpenedAt = Date.now();
  }

  async getSetting(key: string): Promise<string | null> {
    return this.settings.get(key) ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.settings.set(key, value);
  }
}
