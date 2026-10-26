import { concatBytes, decodeUtf8, encodeUtf8 } from './binary';

export const MAX_UPLOAD_BYTES = 180 * 1024 * 1024;

export type HttpRequest = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Uint8Array;
};

export type ParseResult =
  | { kind: 'need-more' }
  | { kind: 'too-large' }
  | { kind: 'ok'; request: HttpRequest; consumed: number };

function headerMap(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of raw.split('\r\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return headers;
}

export function tryParseRequest(buffer: Uint8Array, maxBytes = MAX_UPLOAD_BYTES): ParseResult {
  const headerEnd = indexOfCrlfCrlf(buffer);
  if (headerEnd < 0) {
    if (buffer.length > 64 * 1024) return { kind: 'too-large' };
    return { kind: 'need-more' };
  }
  const head = decodeUtf8(buffer.subarray(0, headerEnd));
  const lines = head.split('\r\n');
  const requestLine = lines[0] ?? '';
  const parts = requestLine.split(' ');
  if (parts.length < 2) return { kind: 'too-large' };
  const method = parts[0].toUpperCase();
  const path = parts[1].split('?')[0] || '/';
  const headers = headerMap(lines.slice(1).join('\r\n'));
  const length = headers['content-length'] ? Number(headers['content-length']) : 0;
  if (!Number.isFinite(length) || length < 0) return { kind: 'too-large' };
  if (length > maxBytes) return { kind: 'too-large' };
  const bodyStart = headerEnd + 4;
  if (buffer.length < bodyStart + length) return { kind: 'need-more' };
  return {
    kind: 'ok',
    consumed: bodyStart + length,
    request: {
      method,
      path,
      headers,
      body: buffer.subarray(bodyStart, bodyStart + length),
    },
  };
}

function indexOfCrlfCrlf(buffer: Uint8Array): number {
  for (let i = 0; i + 3 < buffer.length; i++) {
    if (buffer[i] === 13 && buffer[i + 1] === 10 && buffer[i + 2] === 13 && buffer[i + 3] === 10) {
      return i;
    }
  }
  return -1;
}

export type MultipartFile = {
  filename: string;
  data: Uint8Array;
  fields: Record<string, string>;
};

export function parseMultipart(body: Uint8Array, contentType: string): MultipartFile {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) {
    throw new Error('上传内容不是 multipart，BookPush 需要用表单方式提交文件。');
  }
  const marker = encodeUtf8(`--${boundary.trim()}`);
  const fields: Record<string, string> = {};
  let filename = 'book.bin';
  let data = new Uint8Array();
  let found = false;
  let cursor = 0;
  while (cursor < body.length) {
    const start = indexOf(body, marker, cursor);
    if (start < 0) break;
    let partStart = start + marker.length;
    if (body[partStart] === 45 && body[partStart + 1] === 45) break;
    if (body[partStart] === 13 && body[partStart + 1] === 10) partStart += 2;
    const next = indexOf(body, marker, partStart);
    const partEnd = next < 0 ? body.length : next;
    const rawPart = body.subarray(partStart, partEnd);
    const headerEnd = indexOfCrlfCrlf(rawPart);
    if (headerEnd < 0) {
      cursor = partEnd;
      continue;
    }
    const headerText = decodeUtf8(rawPart.subarray(0, headerEnd));
    let content = rawPart.subarray(headerEnd + 4);
    if (content.length >= 2 && content[content.length - 2] === 13 && content[content.length - 1] === 10) {
      content = content.subarray(0, content.length - 2);
    }
    const disposition = /content-disposition:[^\n]*/i.exec(headerText)?.[0] ?? '';
    const name = /name="([^"]*)"/.exec(disposition)?.[1] ?? '';
    const star = /filename\*=UTF-8''([^;\r\n]+)/i.exec(disposition)?.[1];
    const plain = /filename="([^"]*)"/.exec(disposition)?.[1];
    const partName = star ? safeDecode(star) : plain;
    if (partName && (name === 'file' || !found)) {
      filename = partName;
      data = new Uint8Array(content);
      found = true;
    } else if (name) {
      fields[name] = decodeUtf8(content);
    }
    cursor = next < 0 ? body.length : next;
  }
  if (!found || data.length === 0) {
    throw new Error('没有收到书籍文件。请选择 PDF、EPUB 或 AZW3。');
  }
  return { filename, data, fields };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function indexOf(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  if (needle.length === 0) return from;
  for (let i = from; i + needle.length <= haystack.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

export function jsonResponse(status: number, body: unknown): Uint8Array {
  const payload = JSON.stringify(body);
  const reason =
    status === 200
      ? 'OK'
      : status === 201
        ? 'Created'
        : status === 400
          ? 'Bad Request'
          : status === 401
            ? 'Unauthorized'
            : status === 404
              ? 'Not Found'
              : status === 413
                ? 'Payload Too Large'
                : 'Error';
  const bytes = encodeUtf8(payload);
  const head = encodeUtf8(
    `HTTP/1.1 ${status} ${reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${bytes.length}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n`,
  );
  return concatBytes([head, bytes]);
}

export function htmlResponse(status: number, html: string): Uint8Array {
  const bytes = encodeUtf8(html);
  const head = encodeUtf8(
    `HTTP/1.1 ${status} OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.length}\r\nConnection: close\r\n\r\n`,
  );
  return concatBytes([head, bytes]);
}

export function emptyResponse(status: number): Uint8Array {
  return encodeUtf8(`HTTP/1.1 ${status} No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
}

export function responseText(bytes: Uint8Array): string {
  return decodeUtf8(bytes);
}
