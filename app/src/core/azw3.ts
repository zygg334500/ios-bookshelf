import { ascii, concatBytes, decodeUtf8, u16be, u32be, toBase64 } from './binary';
import { BookError, DRM_MESSAGE, type LoadedBook } from './types';

type ImageAsset = { mime: string; bytes: Uint8Array };

/**
 * DRM-free AZW3 / KF8 / MOBI reader.
 * Encryption type other than 0 is refused. PalmDOC compression is a published
 * packaging scheme, not DRM. Huff/CDIC is reported as unsupported, not stripped.
 */
export function parseAzw3(data: Uint8Array): LoadedBook {
  if (data.length < 80 || ascii(data, 60, 8) !== 'BOOKMOBI') {
    if (data.length >= 2 && data[0] === 0x50 && data[1] === 0x4b) {
      throw new BookError('FORMAT', '这个 AZW3 实际是 ZIP 包，请改扩展名为 EPUB 后再导入。');
    }
    throw new BookError('FORMAT', '这不是有效的 AZW3 / MOBI 文件。');
  }
  const records = recordSlices(data);
  if (records.length < 2) throw new BookError('FORMAT', 'AZW3 记录不完整，无法阅读。');
  const primary = parseSection(records, 0);
  if (primary.encryption !== 0) throw new BookError('DRM', DRM_MESSAGE);
  let chosen = primary;
  if (!looksLikeHtml(primary.html) && primary.kf8Record != null) {
    const boundary = primary.kf8Record;
    const start = ascii(records[boundary] ?? new Uint8Array(), 0, 8) === 'BOUNDARY' ? boundary + 1 : boundary;
    if (records[start] && ascii(records[start], 16, 4) === 'MOBI') {
      const kf8 = parseSection(records, start);
      if (kf8.encryption !== 0) throw new BookError('DRM', DRM_MESSAGE);
      if (looksLikeHtml(kf8.html)) chosen = kf8;
    }
  }
  if (!looksLikeHtml(chosen.html)) {
    const scanned = scanForHtml(records);
    if (scanned) chosen = { ...chosen, html: scanned };
  }
  if (!looksLikeHtml(chosen.html)) {
    if (chosen.compression === 17480) {
      throw new BookError(
        'UNSUPPORTED',
        '这本书使用 Huff/CDIC 压缩。BookShelf 只读取未压缩或 PalmDOC 压缩的无 DRM AZW3，不会尝试绕过保护。请改用你已有权阅读的 EPUB 或 PDF。',
      );
    }
    throw new BookError('UNSUPPORTED', '没能从这本无 DRM 的 AZW3 里取出可排版的正文。可以改试 EPUB 或 PDF。');
  }
  const html = rewriteKindleImages(chosen.html, chosen.images);
  const title = chosen.title || '未命名 AZW3';
  const author = chosen.author || '佚名';
  return {
    format: 'azw3',
    title,
    author,
    chapters: [{ id: 'azw3-1', title, html: extractBody(html), styles: '' }],
    toc: [{ title, chapterIndex: 0 }],
    coverBytes: chosen.cover?.bytes,
    coverMime: chosen.cover?.mime,
  };
}

function looksLikeHtml(text: string): boolean {
  return /<(html|body|p|div|h1|span)\b/i.test(text);
}

function extractBody(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1];
  return (body ?? html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

type Section = {
  encryption: number;
  compression: number;
  html: string;
  title: string;
  author: string;
  images: ImageAsset[];
  cover?: ImageAsset;
  kf8Record: number | null;
};

function parseSection(records: Uint8Array[], recordIndex: number): Section {
  const rec0 = records[recordIndex];
  if (!rec0 || rec0.length < 16 || ascii(rec0, 16, 4) !== 'MOBI') {
    throw new BookError('FORMAT', 'AZW3 缺少 MOBI 头。');
  }
  const compression = u16be(rec0, 0);
  const textLength = u32be(rec0, 4);
  const textRecords = u16be(rec0, 8);
  const encryption = u16be(rec0, 12);
  const headerLength = u32be(rec0, 20);
  const encoding = headerLength >= 16 ? u32be(rec0, 16 + 12) : 65001;
  const fullNameOffset = headerLength > 0x48 ? u32be(rec0, 16 + 0x44) : 0;
  const fullNameLength = headerLength > 0x4c ? u32be(rec0, 16 + 0x48) : 0;
  const firstImage = headerLength > 0x60 ? u32be(rec0, 16 + 0x5c) : 0xffffffff;
  const exthFlags = headerLength > 0x74 ? u32be(rec0, 16 + 0x70) : 0;
  const exth = exthFlags & 0x40 ? readExth(rec0, 16 + headerLength) : new Map<number, Uint8Array[]>();
  const title =
    utf8(exth.get(503)?.[0]) ||
    (fullNameOffset > 0 && fullNameLength > 0
      ? decodeUtf8(rec0.subarray(fullNameOffset, fullNameOffset + fullNameLength))
      : '');
  const author = utf8(exth.get(100)?.[0]);
  const kf8Raw = exth.get(121)?.[0];
  const kf8Record = kf8Raw && kf8Raw.length === 4 ? u32be(kf8Raw, 0) : null;
  if (encryption !== 0) {
    return {
      encryption,
      compression,
      html: '',
      title,
      author,
      images: [],
      kf8Record,
    };
  }
  if (compression !== 1 && compression !== 2 && compression !== 17480) {
    throw new BookError('UNSUPPORTED', `不支持的 AZW3 压缩类型（${compression}）。`);
  }
  const parts: Uint8Array[] = [];
  for (let i = 0; i < textRecords; i++) {
    const rec = records[recordIndex + 1 + i];
    if (rec) parts.push(rec);
  }
  let textBytes = concatBytes(parts);
  if (compression === 2) textBytes = palmdocDecompress(textBytes, textLength);
  else if (compression === 1) textBytes = textBytes.subarray(0, Math.min(textLength, textBytes.length));
  else textBytes = new Uint8Array();
  const html = encoding === 65001 || encoding === 1252 ? decodeUtf8(textBytes) : decodeUtf8(textBytes);
  const images = collectImages(records, firstImage);
  const coverOffset = exth.get(201)?.[0];
  let cover: ImageAsset | undefined;
  if (coverOffset && coverOffset.length >= 4) {
    const index = u32be(coverOffset, 0);
    cover = images[index];
  }
  if (!cover) cover = images.find((image) => image.mime === 'image/jpeg' || image.mime === 'image/png');
  return { encryption, compression, html, title, author, images, cover, kf8Record };
}

function readExth(rec0: Uint8Array, offset: number): Map<number, Uint8Array[]> {
  const map = new Map<number, Uint8Array[]>();
  if (ascii(rec0, offset, 4) !== 'EXTH') return map;
  const count = u32be(rec0, offset + 8);
  let cursor = offset + 12;
  for (let i = 0; i < count && cursor + 8 <= rec0.length; i++) {
    const type = u32be(rec0, cursor);
    const length = u32be(rec0, cursor + 4);
    if (length < 8 || cursor + length > rec0.length) break;
    const value = rec0.subarray(cursor + 8, cursor + length);
    const list = map.get(type) ?? [];
    list.push(value);
    map.set(type, list);
    cursor += length;
  }
  return map;
}

function utf8(bytes: Uint8Array | undefined): string {
  if (!bytes || bytes.length === 0) return '';
  return decodeUtf8(bytes).replace(/\0+$/g, '').trim();
}

function recordSlices(data: Uint8Array): Uint8Array[] {
  const count = u16be(data, 76);
  const slices: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const start = u32be(data, 78 + i * 8);
    const end = i + 1 < count ? u32be(data, 78 + (i + 1) * 8) : data.length;
    if (start > data.length || end < start || end > data.length) {
      throw new BookError('FORMAT', 'AZW3 记录偏移损坏。');
    }
    slices.push(data.subarray(start, end));
  }
  return slices;
}

/** PalmDOC / Mobipocket LZ77, as published by the MobileRead format wiki. */
export function palmdocDecompress(input: Uint8Array, uncompressedLength: number): Uint8Array {
  const out: number[] = [];
  let i = 0;
  const limit = uncompressedLength > 0 ? uncompressedLength : Number.POSITIVE_INFINITY;
  while (i < input.length && out.length < limit) {
    const c = input[i++];
    if (c >= 1 && c <= 8) {
      for (let n = 0; n < c && i < input.length && out.length < limit; n++) out.push(input[i++]);
    } else if (c < 128) {
      out.push(c);
    } else if (c >= 192) {
      if (out.length < limit) out.push(32);
      if (out.length < limit) out.push(c ^ 128);
    } else {
      if (i >= input.length) break;
      const c2 = input[i++];
      const distance = (((c << 8) | c2) >> 3) & 0x7ff;
      const length = (c2 & 0x07) + 3;
      if (distance <= 0 || distance > out.length) break;
      for (let n = 0; n < length && out.length < limit; n++) {
        out.push(out[out.length - distance]);
      }
    }
  }
  return Uint8Array.from(out);
}

function collectImages(records: Uint8Array[], firstImage: number): ImageAsset[] {
  if (!Number.isFinite(firstImage) || firstImage < 0 || firstImage >= records.length || firstImage > 0xffff) {
    return [];
  }
  const images: ImageAsset[] = [];
  for (let i = firstImage; i < records.length; i++) {
    const mime = imageMime(records[i]);
    if (!mime) break;
    images.push({ mime, bytes: records[i] });
  }
  return images;
}

function imageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 4 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return 'image/png';
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'GIF8') return 'image/gif';
  return null;
}

function scanForHtml(records: Uint8Array[]): string | null {
  for (const record of records) {
    const text = decodeUtf8(record);
    if (looksLikeHtml(text)) return text;
  }
  return null;
}

function rewriteKindleImages(html: string, images: ImageAsset[]): string {
  return html.replace(/kindle:embed:([0-9A-Fa-f]+)/g, (full, hex: string) => {
    const index = Number.parseInt(hex, 16);
    const image = images[index - 1] ?? images[index];
    if (!image) return full;
    return `data:${image.mime};base64,${toBase64(image.bytes)}`;
  });
}
