import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createId } from '../core/progress';
import { inspectBook } from '../core/inspect';
import {
  defaultReaderSettings,
  type BookRecord,
  type LoadedBook,
  type ReaderSettings,
} from '../core/types';
import { loadConverter } from '../reader/assets';
import { coverUri, deleteBookFiles, readNamed, scanSharedDocuments, writeNamed } from './bytes';
import { openLibraryStore } from './database';
import type { LibraryStore } from './memory';

export type ShelfBook = BookRecord & { coverUri: string | null };

type ImportResult = { id: string; title: string; format: string };

type LibraryContextValue = {
  ready: boolean;
  error: string | null;
  books: ShelfBook[];
  settings: ReaderSettings;
  pin: string;
  deviceName: string;
  refresh: () => Promise<void>;
  importBytes: (fileName: string, bytes: Uint8Array) => Promise<ImportResult>;
  importShared: () => Promise<number>;
  importBundled: (name: string, bytes: Uint8Array) => Promise<void>;
  removeBook: (id: string) => Promise<void>;
  loadBook: (id: string) => Promise<LoadedBook>;
  savePosition: (id: string, chapterIndex: number, pageIndex: number, progress: number) => Promise<void>;
  saveCover: (id: string, dataUrl: string) => Promise<void>;
  updateSettings: (next: ReaderSettings) => Promise<void>;
  updateDeviceName: (name: string) => Promise<void>;
  regeneratePin: () => Promise<void>;
};

const LibraryContext = createContext<LibraryContextValue | null>(null);

async function withCovers(records: BookRecord[]): Promise<ShelfBook[]> {
  return Promise.all(
    records.map(async (record) => ({
      ...record,
      coverUri: await coverUri(record.id, record.coverName).catch(() => null),
    })),
  );
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<LibraryStore | null>(null);
  const [books, setBooks] = useState<ShelfBook[]>([]);
  const [settings, setSettings] = useState<ReaderSettings>(defaultReaderSettings);
  const [pin, setPin] = useState('0000');
  const [deviceName, setDeviceName] = useState('书房');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!store) return;
    setBooks(await withCovers(await store.list()));
  }, [store]);

  useEffect(() => {
    let cancelled = false;
    openLibraryStore()
      .then(async (opened) => {
        if (cancelled) return;
        let nextPin = await opened.getSetting('pin');
        if (!nextPin) {
          nextPin = String(1000 + Math.floor(Math.random() * 9000));
          await opened.setSetting('pin', nextPin);
        }
        const name = (await opened.getSetting('deviceName')) || '书房';
        const rawSettings = await opened.getSetting('reader');
        if (!cancelled) {
          setStore(opened);
          setPin(nextPin);
          setDeviceName(name);
          if (rawSettings) {
            try {
              setSettings({ ...defaultReaderSettings, ...JSON.parse(rawSettings) });
            } catch {
              setSettings(defaultReaderSettings);
            }
          }
          setBooks(await withCovers(await opened.list()));
          setReady(true);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '书架打不开。');
      });
    loadConverter().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const importBytes = useCallback(
    async (fileName: string, bytes: Uint8Array): Promise<ImportResult> => {
      if (!store) throw new Error('书架还没准备好。');
      const loaded = await inspectBook(fileName, bytes);
      const id = createId();
      await writeNamed(id, 'book.bin', bytes);
      let coverName: string | null = null;
      if (loaded.coverBytes && loaded.coverMime) {
        const ext = loaded.coverMime.includes('png') ? 'png' : loaded.coverMime.includes('gif') ? 'gif' : 'jpg';
        coverName = `cover.${ext}`;
        await writeNamed(id, coverName, loaded.coverBytes);
      }
      const record: BookRecord = {
        id,
        title: loaded.title,
        author: loaded.author,
        format: loaded.format,
        fileName,
        addedAt: Date.now(),
        lastOpenedAt: null,
        chapterIndex: 0,
        pageIndex: 0,
        progress: 0,
        coverName,
      };
      await store.insert(record);
      await refresh();
      return { id, title: record.title, format: record.format };
    },
    [refresh, store],
  );

  const importShared = useCallback(async () => {
    if (!store) return 0;
    const existing = new Set((await store.list()).map((book) => book.fileName));
    const files = await scanSharedDocuments();
    let count = 0;
    for (const file of files) {
      if (existing.has(file.name)) continue;
      await importBytes(file.name, file.bytes);
      existing.add(file.name);
      count += 1;
    }
    return count;
  }, [importBytes, store]);

  const removeBook = useCallback(
    async (id: string) => {
      if (!store) return;
      await store.remove(id);
      await deleteBookFiles(id);
      await refresh();
    },
    [refresh, store],
  );

  const loadBook = useCallback(
    async (id: string) => {
      if (!store) throw new Error('书架还没准备好。');
      const record = (await store.list()).find((book) => book.id === id);
      if (!record) throw new Error('书架上没有这本书。');
      const bytes = await readNamed(id, 'book.bin');
      if (!bytes) throw new Error('这本书的文件不见了。可以删掉记录后重新导入。');
      await store.touch(id);
      return inspectBook(record.fileName, bytes);
    },
    [store],
  );

  const savePosition = useCallback(
    async (id: string, chapterIndex: number, pageIndex: number, progress: number) => {
      if (!store) return;
      await store.updatePosition(id, chapterIndex, pageIndex, progress);
      setBooks((current) =>
        current.map((book) =>
          book.id === id ? { ...book, chapterIndex, pageIndex, progress, lastOpenedAt: Date.now() } : book,
        ),
      );
    },
    [store],
  );

  const saveCover = useCallback(
    async (id: string, dataUrl: string) => {
      if (!store) return;
      const record = books.find((book) => book.id === id);
      if (!record || record.coverName) return;
      const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
      if (!match) return;
      const mime = match[1];
      const binary = atob(match[2]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const coverName = mime.includes('png') ? 'cover.png' : 'cover.jpg';
      await writeNamed(id, coverName, bytes);
      await store.insert({ ...record, coverName });
      await refresh();
    },
    [books, refresh, store],
  );

  const updateSettings = useCallback(
    async (next: ReaderSettings) => {
      setSettings(next);
      await store?.setSetting('reader', JSON.stringify(next));
    },
    [store],
  );

  const updateDeviceName = useCallback(
    async (name: string) => {
      const trimmed = name.trim() || '书房';
      setDeviceName(trimmed);
      await store?.setSetting('deviceName', trimmed);
    },
    [store],
  );

  const regeneratePin = useCallback(async () => {
    const next = String(1000 + Math.floor(Math.random() * 9000));
    setPin(next);
    await store?.setSetting('pin', next);
  }, [store]);

  const value = useMemo<LibraryContextValue>(
    () => ({
      ready,
      error,
      books,
      settings,
      pin,
      deviceName,
      refresh,
      importBytes,
      importShared,
      importBundled: async (name, bytes) => {
        await importBytes(name, bytes);
      },
      removeBook,
      loadBook,
      savePosition,
      saveCover,
      updateSettings,
      updateDeviceName,
      regeneratePin,
    }),
    [
      books,
      deviceName,
      error,
      importBytes,
      importShared,
      loadBook,
      pin,
      ready,
      refresh,
      regeneratePin,
      removeBook,
      saveCover,
      savePosition,
      settings,
      updateDeviceName,
      updateSettings,
    ],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryContextValue {
  const value = useContext(LibraryContext);
  if (!value) throw new Error('useLibrary 必须在 LibraryProvider 内使用');
  return value;
}
