import { Platform } from 'react-native';

const DB_NAME = 'bookshelf-files';
const STORE = 'files';

function key(id: string, name: string): string {
  return `${id}/${name}`;
}

function openWebDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function webWrite(id: string, name: string, bytes: Uint8Array): Promise<void> {
  const db = await openWebDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(new Uint8Array(bytes), key(id, name));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function webRead(id: string, name: string): Promise<Uint8Array | null> {
  const db = await openWebDb();
  const value = await new Promise<Uint8Array | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(key(id, name));
    request.onsuccess = () => resolve(request.result as Uint8Array | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value ? new Uint8Array(value) : null;
}

async function webDelete(id: string): Promise<void> {
  const db = await openWebDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const request = store.getAllKeys();
    request.onsuccess = () => {
      for (const item of request.result) {
        if (String(item).startsWith(`${id}/`)) store.delete(item);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function nativeDir(id: string) {
  const { Directory, Paths } = await import('expo-file-system');
  const dir = new Directory(Paths.document, 'books', id);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export async function writeNamed(id: string, name: string, bytes: Uint8Array): Promise<void> {
  if (Platform.OS === 'web') {
    await webWrite(id, name, bytes);
    return;
  }
  const { File } = await import('expo-file-system');
  const dir = await nativeDir(id);
  const file = new File(dir, name);
  if (file.exists) file.delete();
  file.create();
  await file.write(new Uint8Array(bytes));
}

export async function readNamed(id: string, name: string): Promise<Uint8Array | null> {
  if (Platform.OS === 'web') return webRead(id, name);
  const { File } = await import('expo-file-system');
  const dir = await nativeDir(id);
  const file = new File(dir, name);
  if (!file.exists) return null;
  return file.bytes();
}

export async function deleteBookFiles(id: string): Promise<void> {
  if (Platform.OS === 'web') {
    await webDelete(id);
    return;
  }
  const { Directory, Paths } = await import('expo-file-system');
  const dir = new Directory(Paths.document, 'books', id);
  if (dir.exists) dir.delete();
}

export async function coverUri(id: string, coverName: string | null): Promise<string | null> {
  if (!coverName) return null;
  if (Platform.OS === 'web') {
    const bytes = await webRead(id, coverName);
    if (!bytes) return null;
    return URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
  }
  const { File } = await import('expo-file-system');
  const dir = await nativeDir(id);
  const file = new File(dir, coverName);
  return file.exists ? file.uri : null;
}

export type SharedFile = { name: string; bytes: Uint8Array };

export async function scanSharedDocuments(): Promise<SharedFile[]> {
  if (Platform.OS === 'web') return [];
  const { Directory, File, Paths } = await import('expo-file-system');
  const found: SharedFile[] = [];
  const roots = [new Directory(Paths.document), new Directory(Paths.document, 'Inbox')];
  for (const dir of roots) {
    if (!dir.exists) continue;
    for (const entry of dir.list()) {
      if (!(entry instanceof File)) continue;
      if (!/\.(pdf|epub|azw3)$/i.test(entry.name)) continue;
      found.push({ name: entry.name, bytes: await entry.bytes() });
    }
  }
  return found;
}
