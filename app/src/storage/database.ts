import { Platform } from 'react-native';
import { normalizeReadingMark } from '../core/shelf';
import type { BookFormat, BookRecord, ReadingMark } from '../core/types';
import { MemoryLibrary, type LibraryStore } from './memory';

const WEB_KEY = 'bookshelf.library.v1';

type Row = {
  id: string;
  title: string;
  author: string;
  format: string;
  file_name: string;
  added_at: number;
  last_opened_at: number | null;
  chapter_index: number;
  page_index: number;
  progress: number;
  cover_name: string | null;
  reading_mark?: string | null;
};

function fromRow(row: Row): BookRecord {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    format: row.format as BookFormat,
    fileName: row.file_name,
    addedAt: row.added_at,
    lastOpenedAt: row.last_opened_at,
    chapterIndex: row.chapter_index,
    pageIndex: row.page_index,
    progress: row.progress,
    coverName: row.cover_name,
    readingMark: normalizeReadingMark(row.reading_mark),
  };
}

async function openSqlite(): Promise<LibraryStore> {
  const SQLite = await import('expo-sqlite');
  const db = await SQLite.openDatabaseAsync('bookshelf.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      format TEXT NOT NULL,
      file_name TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      last_opened_at INTEGER,
      chapter_index INTEGER NOT NULL DEFAULT 0,
      page_index INTEGER NOT NULL DEFAULT 0,
      progress REAL NOT NULL DEFAULT 0,
      cover_name TEXT,
      reading_mark TEXT NOT NULL DEFAULT 'auto'
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(books)');
  if (!columns.some((column) => column.name === 'reading_mark')) {
    await db.execAsync("ALTER TABLE books ADD COLUMN reading_mark TEXT NOT NULL DEFAULT 'auto'");
  }
  return {
    async list() {
      const rows = await db.getAllAsync<Row>('SELECT * FROM books ORDER BY added_at DESC');
      return rows.map(fromRow);
    },
    async insert(book) {
      await db.runAsync(
        `INSERT INTO books (id, title, author, format, file_name, added_at, last_opened_at, chapter_index, page_index, progress, cover_name, reading_mark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           author = excluded.author,
           format = excluded.format,
           file_name = excluded.file_name,
           cover_name = excluded.cover_name`,
        book.id,
        book.title,
        book.author,
        book.format,
        book.fileName,
        book.addedAt,
        book.lastOpenedAt,
        book.chapterIndex,
        book.pageIndex,
        book.progress,
        book.coverName,
        normalizeReadingMark(book.readingMark),
      );
    },
    async remove(id) {
      await db.runAsync('DELETE FROM books WHERE id = ?', id);
    },
    async updatePosition(id, chapterIndex, pageIndex, progress) {
      await db.runAsync(
        'UPDATE books SET chapter_index = ?, page_index = ?, progress = ?, last_opened_at = ? WHERE id = ?',
        chapterIndex,
        pageIndex,
        progress,
        Date.now(),
        id,
      );
    },
    async updateReadingMark(id, mark: ReadingMark) {
      await db.runAsync('UPDATE books SET reading_mark = ? WHERE id = ?', normalizeReadingMark(mark), id);
    },
    async touch(id) {
      await db.runAsync('UPDATE books SET last_opened_at = ? WHERE id = ?', Date.now(), id);
    },
    async getSetting(key) {
      const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
      return row?.value ?? null;
    },
    async setSetting(key, value) {
      await db.runAsync(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key,
        value,
      );
    },
  };
}

function webMemoryStore(): LibraryStore {
  const memory = new MemoryLibrary();
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(WEB_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { books?: BookRecord[]; settings?: Record<string, string> };
        memory.books = parsed.books ?? [];
        memory.settings = new Map(Object.entries(parsed.settings ?? {}));
      }
    } catch {
      localStorage.removeItem(WEB_KEY);
    }
  }
  const save = () => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      WEB_KEY,
      JSON.stringify({ books: memory.books, settings: Object.fromEntries(memory.settings) }),
    );
  };
  return {
    list: () => memory.list(),
    insert: async (book) => {
      await memory.insert(book);
      save();
    },
    remove: async (id) => {
      await memory.remove(id);
      save();
    },
    updatePosition: async (id, chapterIndex, pageIndex, progress) => {
      await memory.updatePosition(id, chapterIndex, pageIndex, progress);
      save();
    },
    updateReadingMark: async (id, mark) => {
      await memory.updateReadingMark(id, mark);
      save();
    },
    touch: async (id) => {
      await memory.touch(id);
      save();
    },
    getSetting: (key) => memory.getSetting(key),
    setSetting: async (key, value) => {
      await memory.setSetting(key, value);
      save();
    },
  };
}

export async function openLibraryStore(): Promise<LibraryStore> {
  // expo-sqlite's web build waits on a wasm worker that does not resolve in the
  // browser preview. Metadata stays in localStorage; book bytes stay in IndexedDB.
  if (Platform.OS === 'web') return webMemoryStore();
  const store = await openSqlite();
  await store.list();
  return store;
}
