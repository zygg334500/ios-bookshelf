import { Platform } from 'react-native';
import { concatBytes, decodeUtf8 } from '../core/binary';
import { emptyResponse, htmlResponse, jsonResponse, parseMultipart, tryParseRequest } from '../core/http';

export const TRANSFER_PORT = 27780;

export type TransferSnapshot = {
  running: boolean;
  port: number | null;
  ip: string | null;
  bonjour: boolean;
  error: string | null;
  lastTitle: string | null;
  detail: string;
};

type Hooks = {
  getPin: () => string;
  getName: () => string;
  importBook: (
    fileName: string,
    bytes: Uint8Array,
  ) => Promise<{ id: string; title: string; format: string }>;
};

type TcpSocket = {
  on: (event: string, cb: (data?: Uint8Array) => void) => void;
  write: (data: string) => void;
  destroy: () => void;
};

type TcpServer = {
  listen: (options: { port: number; host: string; reuseAddress?: boolean }) => void;
  once: (event: string, cb: (error?: Error) => void) => void;
  on: (event: string, cb: (socket: TcpSocket) => void) => void;
  close: (cb?: () => void) => void;
  removeAllListeners?: () => void;
};

const listeners = new Set<(snapshot: TransferSnapshot) => void>();
let hooks: Hooks | null = null;
let server: TcpServer | null = null;
let zeroconf: { unpublishService: (name: string) => Promise<unknown> } | null = null;
let publishedName: string | null = null;
let snapshot: TransferSnapshot = {
  running: false,
  port: null,
  ip: null,
  bonjour: false,
  error: null,
  lastTitle: null,
  detail: '尚未开始监听。',
};

function emit(next: Partial<TransferSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener(snapshot);
}

export function getTransferSnapshot(): TransferSnapshot {
  return snapshot;
}

export function subscribeTransfer(listener: (snapshot: TransferSnapshot) => void): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}

export function setTransferHooks(next: Hooks | null) {
  hooks = next;
}

function landing(name: string): string {
  return `<!doctype html><html lang="zh-Hans"><meta charset="utf-8"><title>${name}</title>
  <body style="font-family:Georgia,'Songti SC',serif;background:#f4ecd8;color:#231e18;padding:32px">
  <h1>${name}</h1>
  <p>这是 BookShelf 的局域网收书页。请在 Windows 上打开 BookPush，或在下面选择文件。配对码显示在手机的「传书」页。</p>
  <form method="post" action="/v1/books" enctype="multipart/form-data">
    <p><label>配对码 <input name="pin" inputmode="numeric" required></label></p>
    <p><input type="file" name="file" accept=".pdf,.epub,.azw3" required></p>
    <p><button type="submit">上传</button></p>
  </form></body></html>`;
}

async function handleRequest(bytes: Uint8Array): Promise<Uint8Array> {
  const parsed = tryParseRequest(bytes);
  if (parsed.kind === 'too-large') {
    return jsonResponse(413, { ok: false, error: '文件太大。单本请小于 180 MB。' });
  }
  if (parsed.kind !== 'ok') return jsonResponse(400, { ok: false, error: '请求不完整。' });
  const { method, path, headers, body } = parsed.request;
  if (method === 'OPTIONS') return emptyResponse(204);
  if (method === 'GET' && (path === '/health' || path === '/v1/health')) {
    return jsonResponse(200, {
      ok: true,
      name: hooks?.getName() ?? '书房',
      version: 1,
      pinRequired: true,
      protocol: 'bookshelf-1',
    });
  }
  if (method === 'GET' && path === '/') return htmlResponse(200, landing(hooks?.getName() ?? '书房'));
  if (method === 'POST' && path === '/v1/books') {
    let file;
    try {
      file = parseMultipart(body, headers['content-type'] ?? '');
    } catch (error) {
      return jsonResponse(400, { ok: false, error: error instanceof Error ? error.message : '无法读取上传。' });
    }
    const pin = (headers['x-bookshelf-pin'] || file.fields.pin || '').trim();
    if (!hooks) return jsonResponse(503, { ok: false, error: '手机书架还没准备好。' });
    if (pin !== hooks.getPin()) return jsonResponse(401, { ok: false, error: '配对码不正确。' });
    try {
      const imported = await hooks.importBook(file.filename, file.data);
      emit({ lastTitle: imported.title, detail: `已收入《${imported.title}》` });
      return jsonResponse(201, { ok: true, id: imported.id, title: imported.title, bytes: file.data.length, format: imported.format });
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入失败。';
      return jsonResponse(400, { ok: false, error: message });
    }
  }
  return jsonResponse(404, { ok: false, error: '没有这个地址。' });
}

function listen(instance: TcpServer, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error?: Error) => reject(error ?? new Error('端口被占用'));
    instance.once('error', onError);
    instance.once('listening', () => resolve());
    instance.listen({ port, host: '0.0.0.0', reuseAddress: true });
  });
}

export async function startTransfer(): Promise<void> {
  if (Platform.OS === 'web') {
    emit({
      running: false,
      port: null,
      ip: null,
      bonjour: false,
      error: null,
      detail: '浏览器预览不能监听端口。装到 iPhone 后，这一页会显示 IP 和配对码。',
    });
    return;
  }
  if (server) return;
  try {
    const tcp = await import('react-native-tcp-socket');
    const createServer =
      (tcp as { createServer?: (cb: (socket: TcpSocket) => void) => TcpServer }).createServer ??
      (tcp as { default?: { createServer?: (cb: (socket: TcpSocket) => void) => TcpServer } }).default?.createServer;
    if (!createServer) throw new Error('当前安装包没有 TCP 模块。');
    const Network = await import('expo-network');
    const ip = await Network.getIpAddressAsync().catch(() => null);
    let bound: TcpServer | null = null;
    let port = TRANSFER_PORT;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = createServer((socket) => {
        const chunks: Uint8Array[] = [];
        let length = 0;
        let handled = false;
        const reply = async () => {
          if (handled) return;
          const body = concatBytes(chunks);
          const parsed = tryParseRequest(body);
          if (parsed.kind === 'need-more') return;
          handled = true;
          const response =
            parsed.kind === 'too-large'
              ? jsonResponse(413, { ok: false, error: '文件太大。单本请小于 180 MB。' })
              : await handleRequest(body);
          socket.write(decodeUtf8(response));
          socket.destroy();
        };
        socket.on('data', (data) => {
          if (handled) return;
          const chunk = data instanceof Uint8Array ? data : new Uint8Array();
          chunks.push(chunk);
          length += chunk.length;
          if (length > 180 * 1024 * 1024 + 1024 * 1024) {
            handled = true;
            socket.write(decodeUtf8(jsonResponse(413, { ok: false, error: '文件太大。' })));
            socket.destroy();
            return;
          }
          void reply();
        });
        socket.on('error', () => socket.destroy());
      });
      try {
        await listen(candidate, TRANSFER_PORT + attempt);
        bound = candidate;
        port = TRANSFER_PORT + attempt;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        candidate.close();
      }
    }
    if (!bound) throw lastError ?? new Error('没有可用端口。');
    server = bound;
    let bonjour = false;
    try {
      const mod = await import('react-native-zeroconf');
      const Ctor = (mod as { default?: new () => { publishService: (opts: object) => Promise<unknown>; unpublishService: (name: string) => Promise<unknown> } }).default;
      if (Ctor) {
        const zc = new Ctor();
        const name = hooks?.getName() || 'BookShelf';
        await zc.publishService({
          type: 'bookshelf',
          protocol: 'tcp',
          domain: 'local.',
          name,
          port,
          txt: { version: '1', path: '/v1/books', pin: '1' },
        });
        zeroconf = zc;
        publishedName = name;
        bonjour = true;
      }
    } catch {
      bonjour = false;
    }
    emit({
      running: true,
      port,
      ip,
      bonjour,
      error: null,
      detail: bonjour ? '已在局域网广播，Windows 可以搜索到这台设备。' : '端口已打开。若搜索不到，请在 BookPush 里手工填写 IP。',
    });
  } catch (error) {
    emit({
      running: false,
      error: error instanceof Error ? error.message : '监听失败。',
      detail: '没能打开收书端口。请用 EAS / GitHub Actions 打出的安装包，而不是 Expo Go。文件仍可通过「文件」或文件共享导入。',
    });
  }
}

export async function stopTransfer(): Promise<void> {
  if (zeroconf && publishedName) {
    await zeroconf.unpublishService(publishedName).catch(() => undefined);
  }
  zeroconf = null;
  publishedName = null;
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
  server = null;
  emit({ running: false, port: null, bonjour: false, detail: '已停止监听。' });
}
