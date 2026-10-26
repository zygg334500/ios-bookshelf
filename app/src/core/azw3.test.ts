import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { palmdocDecompress, parseAzw3, stripTrailers } from './azw3';
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

function palmdocCompress(input: Buffer): Buffer {
  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    const byte = input[i] ?? 0;
    if (byte === 0 || (byte >= 9 && byte <= 127)) {
      out.push(byte);
      i += 1;
      continue;
    }
    let count = 1;
    while (count < 8 && i + count < input.length) {
      const next = input[i + count] ?? 0;
      if (next === 0 || (next >= 9 && next <= 127)) break;
      count += 1;
    }
    out.push(count);
    for (let n = 0; n < count; n++) out.push(input[i + n] ?? 0);
    i += count;
  }
  return Buffer.from(out);
}

function packPalm(records: Buffer[]): Uint8Array {
  const header = Buffer.alloc(78);
  header.write('Sample');
  header.write('BOOK', 60);
  header.write('MOBI', 64);
  header.writeUInt16BE(records.length, 76);
  const list = Buffer.alloc(records.length * 8 + 2);
  let cursor = 78 + list.length;
  for (const [index, record] of records.entries()) {
    list.writeUInt32BE(cursor, index * 8);
    cursor += record.length;
  }
  return new Uint8Array(Buffer.concat([header, list, ...records]));
}

function vwi(value: number): Buffer {
  const bytes = [(value & 0x7f) | 0x80];
  let rest = value >>> 7;
  while (rest > 0) {
    bytes.push(rest & 0x7f);
    rest >>>= 7;
  }
  bytes.reverse();
  return Buffer.from(bytes);
}

function indxRecord(tagTable: Buffer, entries: Buffer[] | null): Buffer {
  const tagx = Buffer.concat([Buffer.from('TAGX'), u32(12 + tagTable.length), u32(1), tagTable]);
  const len = 192;
  const head = Buffer.alloc(len);
  head.write('INDX');
  head.writeUInt32BE(len, 4);
  if (!entries) {
    head.writeUInt32BE(1, 24);
    return Buffer.concat([head, tagx]);
  }
  head.writeUInt32BE(entries.length, 24);
  let body = Buffer.alloc(0);
  const positions: number[] = [];
  for (const entry of entries) {
    positions.push(len + body.length);
    body = Buffer.concat([body, entry]);
  }
  const idxtAt = len + body.length;
  head.writeUInt32BE(idxtAt, 20);
  const idxt = Buffer.alloc(4 + positions.length * 2);
  idxt.write('IDXT');
  positions.forEach((position, index) => idxt.writeUInt16BE(position, 4 + index * 2));
  return Buffer.concat([head, body, idxt]);
}

function textEntry(label: string, control: number, values: number[]): Buffer {
  const text = Buffer.from(label, 'utf8');
  return Buffer.concat([Buffer.from([text.length]), text, Buffer.from([control]), ...values.map(vwi)]);
}

function buildCompressed(html: string, title: string, author: string): Uint8Array {
  const htmlBytes = Buffer.from(html, 'utf8');
  const chunks: Buffer[] = [];
  for (let i = 0; i < htmlBytes.length; i += 4096) chunks.push(htmlBytes.subarray(i, i + 4096));
  const textRecords = chunks.map((chunk) => Buffer.concat([palmdocCompress(chunk), Buffer.from([0x81])]));
  const titleBytes = Buffer.from(title, 'utf8');
  const authorBytes = Buffer.from(author, 'utf8');
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
  mobi.write('MOBI');
  mobi.writeUInt32BE(headerLength, 4);
  mobi.writeUInt32BE(2, 8);
  mobi.writeUInt32BE(65001, 12);
  mobi.writeUInt32BE(6, 20);
  mobi.writeUInt32BE(8, 0x58);
  mobi.writeUInt32BE(0xffffffff, 0x5c);
  mobi.writeUInt32BE(0x40, 0x70);
  mobi.writeUInt16BE(2, 0xe2);
  const fullNameOffset = 16 + headerLength + exth.length;
  mobi.writeUInt32BE(fullNameOffset, 0x44);
  mobi.writeUInt32BE(titleBytes.length, 0x48);
  const palm = Buffer.concat([
    u16(2),
    u16(0),
    u32(htmlBytes.length),
    u16(textRecords.length),
    u16(4096),
    u16(0),
    u16(0),
  ]);
  return packPalm([Buffer.concat([palm, mobi, exth, titleBytes]), ...textRecords]);
}

function sectionRecord(html: string, version: number, encryption: number, kf8Record: number | null): Buffer {
  const htmlBytes = Buffer.from(html, 'utf8');
  const titleBytes = Buffer.from('章节', 'utf8');
  const exthParts = [u32(503), u32(titleBytes.length + 8), titleBytes];
  if (kf8Record != null) exthParts.push(u32(121), u32(12), u32(kf8Record));
  const exthRecords = Buffer.concat(exthParts);
  let exth = Buffer.concat([
    Buffer.from('EXTH'),
    u32(12 + exthRecords.length),
    u32(kf8Record == null ? 1 : 2),
    exthRecords,
  ]);
  if (exth.length % 4) exth = Buffer.concat([exth, Buffer.alloc(4 - (exth.length % 4))]);
  const headerLength = 0xe8;
  const mobi = Buffer.alloc(headerLength);
  mobi.write('MOBI');
  mobi.writeUInt32BE(headerLength, 4);
  mobi.writeUInt32BE(version >= 8 ? 248 : 2, 8);
  mobi.writeUInt32BE(65001, 12);
  mobi.writeUInt32BE(version, 20);
  mobi.writeUInt32BE(0xffffffff, 0x5c);
  mobi.writeUInt32BE(0x40, 0x70);
  mobi.writeUInt32BE(16 + headerLength + exth.length, 0x44);
  mobi.writeUInt32BE(titleBytes.length, 0x48);
  const palm = Buffer.concat([
    u16(1),
    u16(0),
    u32(htmlBytes.length),
    u16(1),
    u16(4096),
    u16(encryption),
    u16(0),
  ]);
  return Buffer.concat([palm, mobi, exth, titleBytes]);
}

function buildJoint(): Uint8Array {
  const oldHtml = '<html><body><p>旧版占位</p></body></html>';
  const newHtml = '<html><body><h1>新版</h1><p>新版正文</p></body></html>';
  return packPalm([
    sectionRecord(oldHtml, 6, 0, 2),
    Buffer.from(oldHtml, 'utf8'),
    Buffer.from('BOUNDARY'),
    sectionRecord(newHtml, 8, 0, null),
    Buffer.from(newHtml, 'utf8'),
  ]);
}

function buildHuff(): Uint8Array {
  const book = Buffer.from(buildAzw3('<html><body><p>压着</p></body></html>', '压', '甲', 0));
  const record0 = 78 + 2 * 8 + 2;
  book.writeUInt16BE(17480, record0);
  return book;
}

function buildKf8(): Uint8Array {
  const skeleton = Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><html><head><title>窗下</title><link rel="stylesheet" href="kindle:flow:0001?mime=text/css"/></head><body aid="0"></body></html>',
    'utf8',
  );
  const insertAt = skeleton.indexOf('</body>');
  const fragment = Buffer.from('<h1>窗下</h1><p>窗下的正文没有 DRM。</p><img src="kindle:embed:0001"/>', 'utf8');
  const css = Buffer.from('p { line-height: 1.8; }\n', 'utf8');
  const raw = Buffer.concat([skeleton, fragment, css]);
  const text = Buffer.concat([palmdocCompress(raw), Buffer.from([0x81])]);
  const fdst = Buffer.concat([
    Buffer.from('FDST'),
    u32(12),
    u32(2),
    u32(0),
    u32(skeleton.length + fragment.length),
    u32(skeleton.length + fragment.length),
    u32(raw.length),
  ]);
  const skelTags = Buffer.from([0x01, 0x01, 0x01, 0x00, 0x06, 0x02, 0x02, 0x00, 0x00, 0x00, 0x00, 0x01]);
  const fragTags = Buffer.from([
    0x03, 0x01, 0x01, 0x00, 0x04, 0x01, 0x02, 0x00, 0x06, 0x02, 0x04, 0x00, 0x00, 0x00, 0x00, 0x01,
  ]);
  const skelMain = indxRecord(skelTags, null);
  const skelChild = indxRecord(Buffer.alloc(0), [textEntry('part0000', 0x03, [1, 0, skeleton.length])]);
  const fragMain = indxRecord(fragTags, null);
  const fragChild = indxRecord(Buffer.alloc(0), [textEntry(String(insertAt), 0x07, [0, 0, 0, fragment.length])]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const titleBytes = Buffer.from('窗下', 'utf8');
  const authorBytes = Buffer.from('原创样本', 'utf8');
  const exthRecords = Buffer.concat([
    u32(503),
    u32(titleBytes.length + 8),
    titleBytes,
    u32(100),
    u32(authorBytes.length + 8),
    authorBytes,
    u32(201),
    u32(12),
    u32(0),
  ]);
  let exth = Buffer.concat([Buffer.from('EXTH'), u32(12 + exthRecords.length), u32(3), exthRecords]);
  if (exth.length % 4) exth = Buffer.concat([exth, Buffer.alloc(4 - (exth.length % 4))]);
  const headerLength = 0x108;
  const mobi = Buffer.alloc(headerLength);
  mobi.write('MOBI');
  mobi.writeUInt32BE(headerLength, 4);
  mobi.writeUInt32BE(248, 8);
  mobi.writeUInt32BE(65001, 12);
  mobi.writeUInt32BE(8, 20);
  mobi.writeUInt32BE(8, 0x58);
  mobi.writeUInt32BE(7, 0x5c);
  mobi.writeUInt32BE(0x40, 0x70);
  mobi.writeUInt32BE(2, 0xb0);
  mobi.writeUInt32BE(2, 0xb4);
  mobi.writeUInt16BE(2, 0xe2);
  mobi.writeUInt32BE(5, 0xe8);
  mobi.writeUInt32BE(3, 0xec);
  const fullNameOffset = 16 + headerLength + exth.length;
  mobi.writeUInt32BE(fullNameOffset, 0x44);
  mobi.writeUInt32BE(titleBytes.length, 0x48);
  const palm = Buffer.concat([
    u16(2),
    u16(0),
    u32(raw.length),
    u16(1),
    u16(4096),
    u16(0),
    u16(0),
  ]);
  return packPalm([
    Buffer.concat([palm, mobi, exth, titleBytes]),
    text,
    fdst,
    skelMain,
    skelChild,
    fragMain,
    fragChild,
    jpeg,
  ]);
}

describe('real KF8 packaging', () => {
  it('strips a one-byte trailing entry', () => {
    const trimmed = stripTrailers(Uint8Array.of(0x41, 0x42, 0x81), 2);
    expect(Array.from(trimmed)).toEqual([0x41, 0x42]);
  });

  it('reads PalmDOC records that carry trailing bytes', () => {
    const html = `<html><body><h1>窗下</h1><p>${'雨'.repeat(3000)}停了。</p><mbp:pagebreak/><p>第二章在灯下。</p></body></html>`;
    const book = parseAzw3(buildCompressed(html, '窗下', '原创样本'));
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[0].html).toContain('雨');
    expect(book.chapters[1].html).toContain('第二章在灯下');
  });

  it('rebuilds a DRM-free KF8 skeleton and keeps the image', () => {
    const book = parseAzw3(buildKf8());
    expect(book.title).toBe('窗下');
    expect(book.author).toBe('原创样本');
    expect(book.chapters[0].html).toContain('窗下的正文没有 DRM');
    expect(book.chapters[0].html).not.toContain('kindle:flow');
    expect(book.chapters[0].html).toContain('data:image/jpeg;base64,');
    expect(book.chapters[0].styles).toContain('line-height');
    expect(book.coverBytes?.[0]).toBe(0xff);
  });

  it('prefers the KF8 section and refuses DRM, KFX, and Huff/CDIC', () => {
    const book = parseAzw3(buildJoint());
    expect(book.chapters.map((chapter) => chapter.html).join('\n')).toContain('新版正文');
    expect(book.chapters.map((chapter) => chapter.html).join('\n')).not.toContain('旧版占位');

    expect(() => parseAzw3(buildAzw3('<html><body><p>锁住的正文</p></body></html>', '锁', '甲', 2))).toThrow(BookError);
    try {
      parseAzw3(Buffer.concat([Buffer.from('CONT'), Buffer.alloc(32)]));
    } catch (error) {
      expect((error as BookError).code).toBe('UNSUPPORTED');
      expect((error as Error).message).toContain('不会尝试解除保护');
      expect((error as Error).message).not.toContain('受数字版权保护');
    }
    try {
      parseAzw3(Buffer.concat([Buffer.from('DRMION'), Buffer.alloc(80)]));
    } catch (error) {
      expect((error as BookError).code).toBe('DRM');
      expect((error as Error).message).toBe(DRM_MESSAGE);
    }
    try {
      parseAzw3(buildHuff());
    } catch (error) {
      expect((error as BookError).code).toBe('UNSUPPORTED');
      expect((error as Error).message).toContain('Huff/CDIC');
      expect((error as Error).message).not.toContain('受数字版权保护');
    }
  });

  it('opens a Calibre AZW3 when the local fixture is present', () => {
    const fixture = '/tmp/azw3fix/bob.azw3';
    if (!existsSync(fixture)) return;
    const book = parseAzw3(readFileSync(fixture));
    expect(book.title).toBe('Test Title');
    expect(book.author).toBe('Bob Builder');
    expect(book.chapters[0].html).toContain('Test Title');
    expect(book.chapters[0].html).not.toContain('kindle:flow');
    expect(book.chapters[0].styles.length).toBeGreaterThan(10);
  });
});
