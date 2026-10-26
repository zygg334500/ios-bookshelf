import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { palmdocDecompress, parseAzw3 } from './azw3';
import { BookError, DRM_MESSAGE } from './types';

function u16(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(value);
  return buf;
}
function u32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value >>> 0);
  return buf;
}

function buildAzw3(html: string, title: string, author: string, encryption = 0): Uint8Array {
  const htmlBytes = Buffer.from(html, 'utf8');
  const titleBytes = Buffer.from(title, 'utf8');
  const authorBytes = Buffer.from(author, 'utf8');
  const textRecords: Buffer[] = [];
  for (let i = 0; i < htmlBytes.length; i += 4096) textRecords.push(htmlBytes.subarray(i, i + 4096));
  if (textRecords.length === 0) textRecords.push(Buffer.alloc(0));

  const exthRecords = Buffer.concat([
    u32(503),
    u32(titleBytes.length + 8),
    titleBytes,
    u32(100),
    u32(authorBytes.length + 8),
    authorBytes,
  ]);
  let exth = Buffer.concat([Buffer.from('EXTH'), u32(12 + exthRecords.length), u32(2), exthRecords]);
  if (exth.length % 4) exth = Buffer.concat([exth, Buffer.alloc(4 - (exth.length % 4))]);

  const headerLength = 0xe8;
  const mobi = Buffer.alloc(headerLength);
  mobi.write('MOBI', 0);
  mobi.writeUInt32BE(headerLength, 4);
  mobi.writeUInt32BE(2, 8);
  mobi.writeUInt32BE(65001, 12);
  mobi.writeUInt32BE(42, 16);
  mobi.writeUInt32BE(6, 20);
  mobi.writeUInt32BE(0xffffffff, 0x5c);
  mobi.writeUInt32BE(0x40, 0x70);
  const fullNameOffset = 16 + headerLength + exth.length;
  mobi.writeUInt32BE(fullNameOffset, 0x44);
  mobi.writeUInt32BE(titleBytes.length, 0x48);

  const palm = Buffer.concat([
    u16(1),
    u16(0),
    u32(htmlBytes.length),
    u16(textRecords.length),
    u16(4096),
    u16(encryption),
    u16(0),
  ]);
  const record0 = Buffer.concat([palm, mobi, exth, titleBytes]);
  const records = [record0, ...textRecords];
  const name = Buffer.alloc(32);
  name.write('Sample');
  const header = Buffer.alloc(78);
  name.copy(header, 0);
  header.write('BOOK', 60);
  header.write('MOBI', 64);
  header.writeUInt16BE(records.length, 76);
  const list = Buffer.alloc(records.length * 8 + 2);
  let cursor = 78 + list.length;
  records.forEach((record, index) => {
    list.writeUInt32BE(cursor, index * 8);
    cursor += record.length;
  });
  return new Uint8Array(Buffer.concat([header, list, ...records]));
}

describe('parseAzw3', () => {
  it('reads a DRM-free PalmDOC book', () => {
    const html = '<html><head></head><body><h1>窗下</h1><p>这是没有 DRM 的正文。</p></body></html>';
    const book = parseAzw3(buildAzw3(html, '窗下', '原创样本', 0));
    expect(book.title).toBe('窗下');
    expect(book.author).toBe('原创样本');
    expect(book.chapters[0].html).toContain('没有 DRM');
  });

  it('refuses an encryption flag without trying to decrypt', () => {
    const html = '<html><body><p>secret</p></body></html>';
    expect(() => parseAzw3(buildAzw3(html, '锁', '无', 2))).toThrow(BookError);
    try {
      parseAzw3(buildAzw3(html, '锁', '无', 2));
    } catch (error) {
      expect((error as BookError).code).toBe('DRM');
      expect((error as Error).message).toBe(DRM_MESSAGE);
    }
  });

  it('decompresses a PalmDOC literal and space sequence', () => {
    const input = Uint8Array.of(0x41, 0xc2, 0x05, 0x48, 0x69, 0x21, 0x00);
    const text = new TextDecoder().decode(palmdocDecompress(input, 20));
    expect(text.startsWith('A B')).toBe(true);
    expect(text).toContain('Hi!');
  });
});

describe('sample azw3 fixture', () => {
  it('opens the committed DRM-free sample', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bytes = readFileSync(path.resolve(here, '../../../samples/window-free.azw3'));
    const book = parseAzw3(bytes);
    expect(book.format).toBe('azw3');
    expect(book.title.length).toBeGreaterThan(0);
    expect(book.chapters[0].html.length).toBeGreaterThan(10);
  });
});
