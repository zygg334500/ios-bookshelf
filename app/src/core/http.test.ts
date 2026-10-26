import { describe, expect, it } from 'vitest';
import { encodeUtf8 } from './binary';
import { jsonResponse, parseMultipart, tryParseRequest } from './http';

function request(body: Uint8Array, extraHeaders = ''): Uint8Array {
  const head = encodeUtf8(
    `POST /v1/books HTTP/1.1\r\nHost: phone.local\r\nContent-Type: multipart/form-data; boundary=----BookShelfBoundary7f3a9c\r\nX-Bookshelf-Pin: 2468\r\nContent-Length: ${body.length}\r\n${extraHeaders}\r\n`,
  );
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

describe('http upload parser', () => {
  it('waits until the body arrives', () => {
    const partial = encodeUtf8('POST /health HTTP/1.1\r\nHost: x\r\n');
    expect(tryParseRequest(partial).kind).toBe('need-more');
  });

  it('parses a multipart book and a pin field', () => {
    const boundary = '----BookShelfBoundary7f3a9c';
    const file = encodeUtf8('%PDF-1.4\r\nhello');
    const bodyText =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="pin"\r\n\r\n` +
      `2468\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="窗下.pdf"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`;
    const body = new Uint8Array(encodeUtf8(bodyText).length + file.length + encodeUtf8(`\r\n--${boundary}--\r\n`).length);
    const prefix = encodeUtf8(bodyText);
    const suffix = encodeUtf8(`\r\n--${boundary}--\r\n`);
    body.set(prefix, 0);
    body.set(file, prefix.length);
    body.set(suffix, prefix.length + file.length);
    const parsed = tryParseRequest(request(body));
    expect(parsed.kind).toBe('ok');
    if (parsed.kind !== 'ok') return;
    expect(parsed.request.headers['x-bookshelf-pin']).toBe('2468');
    const filePart = parseMultipart(parsed.request.body, parsed.request.headers['content-type']);
    expect(filePart.filename).toBe('窗下.pdf');
    expect(filePart.fields.pin).toBe('2468');
    expect(new TextDecoder().decode(filePart.data)).toBe('%PDF-1.4\r\nhello');
  });

  it('rejects oversized content length', () => {
    const raw = encodeUtf8('POST /v1/books HTTP/1.1\r\nContent-Length: 9999999999\r\n\r\n');
    expect(tryParseRequest(raw, 1024).kind).toBe('too-large');
  });

  it('writes a json response with a length', () => {
    const text = new TextDecoder().decode(jsonResponse(201, { ok: true, title: '窗' }));
    expect(text.startsWith('HTTP/1.1 201 Created')).toBe(true);
    expect(text).toContain('"title":"窗"');
  });
});
