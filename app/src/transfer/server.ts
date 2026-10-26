import { Platform } from 'react-native';
import { concatBytes, decodeUtf8 } from '../core/binary';
import { emptyResponse, htmlResponse, jsonResponse, parseMultipart, tryParseRequest } from '../core/http';
import { bonjourInstanceName, bonjourTxt, transferDetail } from './bonjour';

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

type ZeroconfClient = {
  publishService: (opts: object) => Promise<{ name?: string } | null>;
  unpublishService: (name: string) => Promise<unknown>;
  updateService?: (name: string, opts: { txt?: Record<string, string> }) => Promise<unknown>;
  checkLocalNetworkAccess?: (opts: { type?: string; protocol?: string; timeout?: number }) => Promise<string>;
};

const listeners = new Set<(snapshot: TransferSnapshot) => void>();
let hooks: Hooks | null = null;
let server: TcpServer | null = null;
let boundPort: number | null = null;
let zeroconf: ZeroconfClient | null = null;
let publishedName: string | null = null;
let epoch = 0;
let chain: Promise<void> = Promise.resolve();
let lastNetwork: { wifi: boolean; vpn: boolean; access: 'granted' | 'denied' | 'unknown' } = {
  wifi: true,
  vpn: false,
  access: 'unknown',
};
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
    <p><input type="file" name="file" accept=".pdf,.epub,.azw3,.azw,.mobi,.kf8" required></p>
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

function enqueue(task: () => Promise<void>): Promise<void> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readNetwork(): Promise<{ ip: string | null; wifi: boolean; vpn: boolean }> {
  const Network = await import('expo-network');
  const [ip, state] = await Promise.all([
    Network.getIpAddressAsync().catch(() => null),
    Network.getNetworkStateAsync().catch(() => null),
  ]);
  const type = state?.type;
  const wifi = !type || type === Network.NetworkStateType.WIFI || type === Network.NetworkStateType.UNKNOWN;
  const vpn = type === Network.NetworkStateType.VPN;
  return { ip: ip && ip !== '0.0.0.0' ? ip : null, wifi: vpn ? false : wifi, vpn };
}

async function publishBonjour(port: number): Promise<boolean> {
  const display = hooks?.getName() || '书房';
  const name = bonjourInstanceName(display);
  const txt = bonjourTxt(display);
  try {
    if (!zeroconf) {
      const mod = await import('react-native-zeroconf');
      const Ctor = (mod as { default?: new () => ZeroconfClient }).default;
      if (!Ctor) return false;
      zeroconf = new Ctor();
    }
    if (publishedName === name) {
      await zeroconf.updateService?.(publishedName, { txt });
      return true;
    }
    if (publishedName) {
      await zeroconf.unpublishService(publishedName).catch(() => undefined);
      publishedName = null;
    }
    const published = await zeroconf.publishService({
      type: 'bookshelf',
      protocol: 'tcp',
      domain: 'local.',
      name,
      port,
      txt,
    });
    publishedName = published?.name || name;
    return true;
  } catch {
    return false;
  }
}

async function unpublishBonjour(): Promise<void> {
  if (zeroconf && publishedName) {
    await zeroconf.unpublishService(publishedName).catch(() => undefined);
  }
  publishedName = null;
}

async function describeAccess(client: ZeroconfClient | null): Promise<'granted' | 'denied' | 'unknown'> {
  if (!client?.checkLocalNetworkAccess) return 'unknown';
  try {
    const access = await client.checkLocalNetworkAccess({ type: 'bookshelf', protocol: 'tcp', timeout: 3 });
    if (access === 'granted' || access === 'denied') return access;
  } catch {
    return 'unknown';
  }
  return 'unknown';
}

async function openListener(): Promise<void> {
  if (Platform.OS === 'web') {
    emit({
      running: false,
      port: null,
      ip: null,
      bonjour: false,
      error: null,
      detail: '浏览器预览不能监听端口。装到 iPhone 后，这一页会显示 IP、端口和配对码。',
    });
    return;
  }
  if (server) return;
  const token = epoch;
  const tcp = await import('react-native-tcp-socket');
  const createServer =
    (tcp as { createServer?: (cb: (socket: TcpSocket) => void) => TcpServer }).createServer ??
    (tcp as { default?: { createServer?: (cb: (socket: TcpSocket) => void) => TcpServer } }).default?.createServer;
  if (!createServer) throw new Error('当前安装包没有 TCP 模块。');
  const network = await readNetwork();
  let bound: TcpServer | null = null;
  let port = TRANSFER_PORT;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
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
  if (token !== epoch) {
    await new Promise<void>((resolve) => bound?.close(() => resolve()));
    return;
  }
  server = bound;
  boundPort = port;
  lastNetwork = { wifi: network.wifi, vpn: network.vpn, access: 'unknown' };
  const bonjour = await publishBonjour(port);
  if (token !== epoch) return;
  emit({
    running: true,
    port,
    ip: network.ip,
    bonjour,
    error: null,
    detail: transferDetail({ bonjour, access: 'unknown', ip: network.ip, wifi: network.wifi, vpn: network.vpn }),
  });
  const access = await describeAccess(zeroconf);
  if (token !== epoch) return;
  lastNetwork = { ...lastNetwork, access };
  emit({
    detail: transferDetail({ bonjour, access, ip: network.ip, wifi: network.wifi, vpn: network.vpn }),
  });
}

async function closeListener(): Promise<void> {
  epoch += 1;
  await unpublishBonjour();
  zeroconf = null;
  if (server) {
    const closing = server;
    server = null;
    boundPort = null;
    await new Promise<void>((resolve) => closing.close(() => resolve()));
  }
  emit({ running: false, port: null, bonjour: false, detail: '已停止监听。' });
}

export function startTransfer(): Promise<void> {
  return enqueue(async () => {
    try {
      await openListener();
    } catch (error) {
      emit({
        running: false,
        error: error instanceof Error ? error.message : '监听失败。',
        detail: '没能打开收书端口。请用 GitHub Actions 打出的安装包，而不是 Expo Go。文件仍可通过「文件」或文件共享导入。',
      });
    }
  });
}

export function republishTransfer(): Promise<void> {
  return enqueue(async () => {
    if (!server || boundPort == null) return;
    const bonjour = await publishBonjour(boundPort);
    emit({
      bonjour,
      detail: transferDetail({
        bonjour,
        access: lastNetwork.access,
        ip: snapshot.ip,
        wifi: lastNetwork.wifi,
        vpn: lastNetwork.vpn,
      }),
    });
  });
}

export function restartTransfer(): Promise<void> {
  return enqueue(async () => {
    await closeListener();
    try {
      await openListener();
    } catch (error) {
      emit({
        running: false,
        error: error instanceof Error ? error.message : '监听失败。',
        detail: '没能重新打开收书端口。请确认安装的是 IPA，而不是 Expo Go。',
      });
    }
  });
}

export function stopTransfer(): Promise<void> {
  return enqueue(() => closeListener());
}
