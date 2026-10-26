import { ascii, concatBytes, decodeUtf8, u16be, u32be, toBase64 } from './binary';
import { BookError, DRM_MESSAGE, type Chapter, type LoadedBook } from './types';

type ImageAsset = { mime: string; bytes: Uint8Array };

const HUFF_MESSAGE =
  '这本书使用 Huff/CDIC 压缩。BookShelf 只读取未压缩或 PalmDOC 压缩的无 DRM AZW3，不会尝试绕过保护。请改用你已有权阅读的 EPUB 或 PDF。';
const KFX_MESSAGE =
  '这不是无 DRM 的 AZW3，而像是 Kindle 的 KFX 容器。BookShelf 打不开它，也不会尝试解除保护。请改用无 DRM 的 AZW3、EPUB 或 PDF，或使用 Amazon 自己的阅读器。';
const EMPTY_MESSAGE = '没能从这本无 DRM 的 AZW3 里取出可排版的正文。可以改试 EPUB 或 PDF。';

/**
 * DRM-free AZW3 / KF8 / MOBI reader.
 * Encryption type other than 0 is refused before any text is decoded.
 * PalmDOC and the published KF8 skeleton/fragment layout are packaging, not DRM.
 * Huff/CDIC stays unsupported. Nothing here reads a Kindle key or ciphertext.
 */
export function parseAzw3(data: Uint8Array): LoadedBook {
  if (data.length >= 2 && data[0] === 0x50 && data[1] === 0x4b) {
    throw new BookError('FORMAT', '这个 AZW3 实际是 ZIP 包，请改扩展名为 EPUB 后再导入。');
  }
  if (containsDrmion(data)) throw new BookError('DRM', DRM_MESSAGE);
  if (looksLikeKfx(data)) throw new BookError('UNSUPPORTED', KFX_MESSAGE);
  if (data.length < 80 || ascii(data, 60, 8) !== 'BOOKMOBI') {
    throw new BookError('FORMAT', '这不是有效的 AZW3 / MOBI 文件。');
  }
  const records = recordSlices(data);
  if (records.length < 2) throw new BookError('FORMAT', 'AZW3 记录不完整，无法阅读。');
  const primary = parseSection(records, 0);
  if (primary.encryption !== 0) throw new BookError('DRM', DRM_MESSAGE);

  const sections: Section[] = [];
  if (!primary.isKf8 && primary.kf8Record != null) {
    const boundary = primary.kf8Record;
    const record = records[boundary];
    const start = record && ascii(record, 0, 8) === 'BOUNDARY' ? boundary + 1 : boundary;
    const kf8 = trySection(records, start);
    if (kf8) {
      if (kf8.encryption !== 0) throw new BookError('DRM', DRM_MESSAGE);
      sections.push(kf8);
    }
  }
  sections.push(primary);

  let sawHuff = false;
  for (const section of sections) {
    if (section.compression === 17480) {
      sawHuff = true;
      continue;
    }
    const book = renderSection(section, records);
    if (book) return book;
  }
  if (sawHuff) throw new BookError('UNSUPPORTED', HUFF_MESSAGE);
  throw new BookError('UNSUPPORTED', EMPTY_MESSAGE);
}

function containsDrmion(data: Uint8Array): boolean {
  const head = data.subarray(0, Math.min(data.length, 1024));
  return ascii(head, 0, head.length).includes('DRMION');
}

function looksLikeKfx(data: Uint8Array): boolean {
  if (data.length >= 4 && (ascii(data, 0, 3) === 'CR!' || ascii(data, 0, 4) === 'CONT')) return true;
  return data.length >= 15 && ascii(data, 0, 15) === 'SQLite format 3';
}

type Section = {
  recordIndex: number;
  encryption: number;
  compression: number;
  isKf8: boolean;
  rawText: Uint8Array;
  encoding: number;
  title: string;
  author: string;
  images: ImageAsset[];
  cover?: ImageAsset;
  kf8Record: number | null;
  skelIndex: number | null;
  fragIndex: number | null;
  fdstIndex: number | null;
  fdstCount: number;
};

function trySection(records: Uint8Array[], recordIndex: number): Section | null {
  const rec0 = records[recordIndex];
  if (!rec0 || rec0.length < 20 || ascii(rec0, 16, 4) !== 'MOBI') return null;
  try {
    return parseSection(records, recordIndex);
  } catch (error) {
    if (error instanceof BookError && error.code === 'DRM') throw error;
    return null;
  }
}

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
  const headerEnd = Math.min(rec0.length, 16 + headerLength);
  const mobiType = readU32(rec0, 0x18, headerEnd) ?? 0;
  const encoding = readU32(rec0, 0x1c, headerEnd) ?? 65001;
  const version = readU32(rec0, 0x24, headerEnd) ?? 0;
  const minVersion = readU32(rec0, 0x68, headerEnd) ?? 0;
  const fullNameOffset = readU32(rec0, 0x54, headerEnd) ?? 0;
  const fullNameLength = readU32(rec0, 0x58, headerEnd) ?? 0;
  const firstImageRaw = readU32(rec0, 0x6c, headerEnd);
  const exthFlags = readU32(rec0, 0x80, headerEnd) ?? 0;
  const exth = exthFlags & 0x40 ? readExth(rec0, 16 + headerLength) : new Map<number, Uint8Array[]>();
  const title =
    utf8(exth.get(503)?.[0]) ||
    (fullNameOffset > 0 && fullNameLength > 0 && fullNameOffset + fullNameLength <= rec0.length
      ? decodeUtf8(rec0.subarray(fullNameOffset, fullNameOffset + fullNameLength))
      : '');
  const author = utf8(exth.get(100)?.[0]);
  const kf8Raw = exth.get(121)?.[0];
  const kf8Record = kf8Raw && kf8Raw.length >= 4 ? u32be(kf8Raw, 0) : null;
  const isKf8 = version >= 8 || mobiType === 248;
  const trailFlags = headerLength >= 0xe4 && minVersion >= 5 ? readU16(rec0, 0xf2, headerEnd) ?? 0 : 0;
  const fdstCount = readU32(rec0, 0xc4, headerEnd) ?? 0;
  const fdstIndex = fdstCount > 1 ? absoluteIndex(recordIndex, readU32(rec0, 0xc0, headerEnd)) : null;
  const skelIndex = isKf8 ? absoluteIndex(recordIndex, readU32(rec0, 0xfc, headerEnd)) : null;
  const fragIndex = isKf8 ? absoluteIndex(recordIndex, readU32(rec0, 0xf8, headerEnd)) : null;
  const firstImage = absoluteIndex(recordIndex, firstImageRaw ?? null);
  const images = collectImages(records, firstImage);
  const coverOffset = exth.get(201)?.[0];
  let cover: ImageAsset | undefined;
  if (coverOffset && coverOffset.length >= 4) cover = images[u32be(coverOffset, 0)];
  if (!cover) cover = images.find((image) => image.mime === 'image/jpeg' || image.mime === 'image/png');

  if (encryption !== 0) {
    return {
      recordIndex,
      encryption,
      compression,
      isKf8,
      rawText: new Uint8Array(),
      encoding,
      title,
      author,
      images: [],
      kf8Record,
      skelIndex,
      fragIndex,
      fdstIndex,
      fdstCount,
    };
  }
  if (compression !== 1 && compression !== 2 && compression !== 17480) {
    throw new BookError('UNSUPPORTED', `不支持的 AZW3 压缩类型（${compression}）。`);
  }
  const rawText =
    compression === 17480
      ? new Uint8Array()
      : decodeTextRecords(records, recordIndex, textRecords, textLength, compression, trailFlags);
  return {
    recordIndex,
    encryption,
    compression,
    isKf8,
    rawText,
    encoding,
    title,
    author,
    images,
    cover,
    kf8Record,
    skelIndex,
    fragIndex,
    fdstIndex,
    fdstCount,
  };
}

function renderSection(section: Section, records: Uint8Array[]): LoadedBook | null {
  if (section.rawText.length === 0) return null;
  if (ascii(section.rawText, 0, 4) === '%MOP') return null;
  const flows = splitFlows(section.rawText, section.fdstIndex != null ? records[section.fdstIndex] : undefined, section.fdstCount);
  const textFlow = flows[0] ?? section.rawText;
  const assembled = assembleKf8(textFlow, records, section);
  const pieces = (assembled ?? [textFlow]).flatMap((piece) => splitPageBreaks(piece));
  const styles = collectCss(flows.slice(1), section.encoding, section.images);
  const chapters: Chapter[] = [];
  for (const piece of pieces) {
    const html = extractBody(rewriteKindle(decodeBytes(piece, section.encoding), section.images));
    if (!visibleText(html)) continue;
    const heading = headingOf(html);
    chapters.push({
      id: `azw3-${chapters.length + 1}`,
      title: heading || (chapters.length === 0 ? section.title || '正文' : `第 ${chapters.length + 1} 章`),
      html,
      styles,
    });
  }
  if (chapters.length === 0) return null;
  const title = section.title || chapters[0]?.title || '未命名 AZW3';
  if (chapters.length === 1 && !headingOf(chapters[0].html)) chapters[0].title = title;
  return {
    format: 'azw3',
    title,
    author: section.author || '佚名',
    chapters,
    toc: chapters.map((chapter, chapterIndex) => ({ title: chapter.title, chapterIndex })),
    coverBytes: section.cover?.bytes,
    coverMime: section.cover?.mime,
  };
}

function assembleKf8(flow: Uint8Array, records: Uint8Array[], section: Section): Uint8Array[] | null {
  if (section.skelIndex == null) return null;
  const skelEntries = readIndex(records, section.skelIndex);
  if (skelEntries.length === 0) return null;
  const fragEntries = section.fragIndex != null ? readIndex(records, section.fragIndex) : [];
  const frags = fragEntries.map((entry, order) => {
    const pair = entry.tags.get(6) ?? [];
    const length = pair.length >= 2 ? pair[1] : (pair[0] ?? 0);
    const insertPos = Number.parseInt(entry.label, 10);
    return { insertPos: Number.isFinite(insertPos) ? insertPos : 0, length, order };
  });
  const parts: Uint8Array[] = [];
  let fragIndex = 0;
  for (const entry of skelEntries) {
    const pair = entry.tags.get(6) ?? [];
    const pos = pair[0] ?? 0;
    const len = pair.length >= 2 ? pair[1] : 0;
    const fragCount = entry.tags.get(1)?.[0] ?? 0;
    if (pos < 0 || len < 0 || pos + len > flow.length) return null;
    const inserts: { at: number; bytes: Uint8Array; order: number }[] = [];
    let readAt = pos + len;
    for (let n = 0; n < fragCount && fragIndex < frags.length; n++) {
      const frag = frags[fragIndex++];
      if (frag.length < 0 || readAt + frag.length > flow.length) return null;
      inserts.push({
        at: frag.insertPos - pos,
        bytes: flow.subarray(readAt, readAt + frag.length),
        order: frag.order,
      });
      readAt += frag.length;
    }
    inserts.sort((a, b) => b.at - a.at || b.order - a.order);
    let merged = flow.subarray(pos, pos + len);
    for (const insert of inserts) {
      const at = Math.max(0, Math.min(merged.length, insert.at));
      merged = concatBytes([merged.subarray(0, at), insert.bytes, merged.subarray(at)]);
    }
    parts.push(merged);
  }
  return parts.length > 0 ? parts : null;
}

function splitFlows(raw: Uint8Array, fdst: Uint8Array | undefined, count: number): Uint8Array[] {
  if (!fdst || count <= 1 || fdst.length < 16 || ascii(fdst, 0, 4) !== 'FDST') return [raw];
  const n = u32be(fdst, 8);
  if (!Number.isFinite(n) || n <= 1 || 12 + n * 8 > fdst.length) return [raw];
  const starts: number[] = [];
  for (let i = 0; i < n; i++) starts.push(u32be(fdst, 12 + i * 8));
  starts.push(raw.length);
  const flows: Uint8Array[] = [];
  for (let i = 0; i < starts.length - 1; i++) {
    const from = Math.max(0, Math.min(raw.length, starts[i] ?? 0));
    const to = Math.max(from, Math.min(raw.length, starts[i + 1] ?? raw.length));
    flows.push(raw.subarray(from, to));
  }
  return flows.length > 0 ? flows : [raw];
}

function splitPageBreaks(piece: Uint8Array): Uint8Array[] {
  const text = decodeUtf8(piece);
  if (!/<mbp:pagebreak\b/i.test(text)) return [piece];
  const parts = text.split(/<mbp:pagebreak\b[^>]*\/?>/i).filter((part) => visibleText(part));
  if (parts.length <= 1) return [piece];
  return parts.map((part) => new TextEncoder().encode(part));
}

type IndexEntry = { label: string; tags: Map<number, number[]> };

function readIndex(records: Uint8Array[], index: number): IndexEntry[] {
  const main = records[index];
  if (!main || ascii(main, 0, 4) !== 'INDX') return [];
  const header = parseIndxHeader(main);
  const tags = header ? readTagSection(main, header.len) : null;
  if (!header || !tags || tags.controlBytes > 32) return [];
  const entries: IndexEntry[] = [];
  const childCount = Math.min(header.count, records.length);
  if (childCount <= 0) {
    entries.push(...readIndexEntries(main, tags.controlBytes, tags.tags));
  } else {
    for (let i = 1; i <= childCount; i++) {
      const child = records[index + i];
      if (!child || ascii(child, 0, 4) !== 'INDX') break;
      entries.push(...readIndexEntries(child, tags.controlBytes, tags.tags));
    }
  }
  return entries;
}

function parseIndxHeader(data: Uint8Array): { len: number; start: number; count: number } | null {
  if (data.length < 56 || ascii(data, 0, 4) !== 'INDX') return null;
  return { len: u32be(data, 4), start: u32be(data, 20), count: u32be(data, 24) };
}

function readTagSection(data: Uint8Array, start: number): { controlBytes: number; tags: TagSpec[] } | null {
  let offset = start;
  if (ascii(data, offset, 4) !== 'TAGX') {
    const found = indexOfAscii(data, 'TAGX');
    if (found < 0) return null;
    offset = found;
  }
  if (offset + 12 > data.length) return null;
  const first = u32be(data, offset + 4);
  const controlBytes = u32be(data, offset + 8);
  if (first < 12 || offset + first > data.length) return null;
  const tags: TagSpec[] = [];
  for (let i = 12; i + 4 <= first; i += 4) {
    const pos = offset + i;
    tags.push({ tag: data[pos], valuesPerEntry: data[pos + 1], mask: data[pos + 2], endFlag: data[pos + 3] });
  }
  return { controlBytes, tags };
}

type TagSpec = { tag: number; valuesPerEntry: number; mask: number; endFlag: number };

function readIndexEntries(record: Uint8Array, controlBytes: number, tagTable: TagSpec[]): IndexEntry[] {
  const header = parseIndxHeader(record);
  if (!header || header.start + 4 > record.length || ascii(record, header.start, 4) !== 'IDXT') return [];
  const positions: number[] = [];
  for (let i = 0; i < header.count; i++) {
    const at = header.start + 4 + i * 2;
    if (at + 2 > record.length) return [];
    positions.push(u16be(record, at));
  }
  positions.push(header.start);
  const entries: IndexEntry[] = [];
  for (let i = 0; i < header.count; i++) {
    const start = positions[i] ?? 0;
    const end = positions[i + 1] ?? start;
    if (start < 0 || end < start || end > record.length || start >= record.length) continue;
    const textLength = record[start] ?? 0;
    if (start + 1 + textLength > end) continue;
    const label = decodeUtf8(record.subarray(start + 1, start + 1 + textLength));
    const tags = tagMap(controlBytes, tagTable, record, start + 1 + textLength, end);
    if (!tags) continue;
    entries.push({ label, tags });
  }
  return entries;
}

function tagMap(
  controlBytes: number,
  tagTable: TagSpec[],
  entry: Uint8Array,
  start: number,
  end: number,
): Map<number, number[]> | null {
  if (start + controlBytes > entry.length) return null;
  const pending: { tag: number; valueCount: number | null; valueBytes: number | null; valuesPerEntry: number }[] = [];
  let controlIndex = 0;
  let dataStart = start + controlBytes;
  for (const spec of tagTable) {
    if (spec.endFlag === 0x01) {
      controlIndex += 1;
      continue;
    }
    if (start + controlIndex >= entry.length) return null;
    let mask = spec.mask;
    let value = (entry[start + controlIndex] ?? 0) & mask;
    if (value !== 0) {
      if (value === mask && countSetBits(mask) > 1) {
        const read = readVwi(entry, dataStart);
        if (!read) return null;
        dataStart += read.consumed;
        pending.push({ tag: spec.tag, valueCount: null, valueBytes: read.value, valuesPerEntry: spec.valuesPerEntry });
      } else if (value === mask) {
        pending.push({ tag: spec.tag, valueCount: 1, valueBytes: null, valuesPerEntry: spec.valuesPerEntry });
      } else {
        while ((mask & 0x01) === 0) {
          mask >>= 1;
          value >>= 1;
        }
        pending.push({ tag: spec.tag, valueCount: value, valueBytes: null, valuesPerEntry: spec.valuesPerEntry });
      }
    }
  }
  const map = new Map<number, number[]>();
  for (const item of pending) {
    const values: number[] = [];
    if (item.valueCount != null) {
      for (let i = 0; i < item.valueCount * Math.max(item.valuesPerEntry, 1); i++) {
        const read = readVwi(entry, dataStart);
        if (!read) return null;
        dataStart += read.consumed;
        values.push(read.value);
      }
    } else if (item.valueBytes != null) {
      const stop = dataStart + item.valueBytes;
      if (stop > entry.length) return null;
      while (dataStart < stop) {
        const read = readVwi(entry, dataStart);
        if (!read) return null;
        dataStart += read.consumed;
        values.push(read.value);
      }
    }
    map.set(item.tag, values);
  }
  return map;
}

function readVwi(data: Uint8Array, offset: number): { consumed: number; value: number } | null {
  let value = 0;
  let consumed = 0;
  while (consumed < 5 && offset + consumed < data.length) {
    const byte = data[offset + consumed] ?? 0;
    consumed += 1;
    value = (value << 7) | (byte & 0x7f);
    if (byte & 0x80) return { consumed, value };
  }
  return null;
}

function countSetBits(value: number): number {
  let count = 0;
  for (let i = 0; i < 8; i++) if ((value & (1 << i)) !== 0) count += 1;
  return count;
}

function decodeTextRecords(
  records: Uint8Array[],
  recordIndex: number,
  textRecords: number,
  textLength: number,
  compression: number,
  trailFlags: number,
): Uint8Array {
  const parts: Uint8Array[] = [];
  let remaining = textLength > 0 ? textLength : Number.POSITIVE_INFINITY;
  for (let i = 0; i < textRecords && remaining > 0; i++) {
    const rec = records[recordIndex + 1 + i];
    if (!rec) throw new BookError('FORMAT', 'AZW3 正文记录缺失。');
    const trimmed = stripTrailers(rec, trailFlags);
    const limit = Math.min(4096, remaining);
    const plain =
      compression === 2 ? palmdocDecompress(trimmed, limit) : trimmed.subarray(0, Math.min(trimmed.length, limit));
    parts.push(plain);
    remaining -= plain.length;
  }
  return concatBytes(parts);
}

/** Drop the published MOBI trailing entries before PalmDOC decompression. */
export function stripTrailers(data: Uint8Array, flags: number): Uint8Array {
  if (!flags || data.length === 0) return data;
  let out = data;
  let bits = flags;
  let trailers = 0;
  while (bits > 1) {
    if (bits & 2) trailers += 1;
    bits >>= 1;
  }
  for (let i = 0; i < trailers; i++) {
    const size = trailingEntrySize(out);
    if (size <= 0 || size > out.length) break;
    out = out.subarray(0, out.length - size);
  }
  if ((flags & 1) && out.length > 0) {
    const extra = ((out[out.length - 1] ?? 0) & 3) + 1;
    if (extra <= out.length) out = out.subarray(0, out.length - extra);
  }
  return out;
}

function trailingEntrySize(data: Uint8Array): number {
  const start = Math.max(0, data.length - 4);
  let num = 0;
  for (let i = start; i < data.length; i++) {
    const value = data[i] ?? 0;
    if (value & 0x80) num = 0;
    num = (num << 7) | (value & 0x7f);
  }
  return num;
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

function collectCss(flows: Uint8Array[], encoding: number, images: ImageAsset[]): string {
  const sheets: string[] = [];
  for (const flow of flows) {
    const text = decodeBytes(flow, encoding).replace(/\0/g, '').trim();
    if (!text) continue;
    const blocks = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1] ?? '');
    const css = (blocks.length > 0 ? blocks.join('\n') : text).replace(/<\/?style[^>]*>/gi, '');
    if (!css.trim()) continue;
    sheets.push(rewriteKindle(css, images));
  }
  return sheets.join('\n');
}

function rewriteKindle(text: string, images: ImageAsset[]): string {
  const withoutFlows = text.replace(/<link\b[^>]*kindle:flow:[^>]*>/gi, '');
  return withoutFlows
    .replace(/kindle:embed:([0-9A-Fa-f]+)(?:\?[^"' )\s]*)?/g, (full, hex: string) => {
      const index = Number.parseInt(hex, 16);
      const image = images[index - 1] ?? images[index];
      if (!image) return full;
      return `data:${image.mime};base64,${toBase64(image.bytes)}`;
    })
    .replace(/kindle:pos:[^"' )\s]*/g, '#')
    .replace(/<img\b([^>]*?)\srecindex\s*=\s*["'](\d+)["']([^>]*)>/gi, (full, before: string, digits: string, after: string) => {
      const image = images[Number.parseInt(digits, 10) - 1];
      if (!image) return full;
      return `<img${before} src="data:${image.mime};base64,${toBase64(image.bytes)}"${after}>`;
    });
}

function collectImages(records: Uint8Array[], firstImage: number | null): ImageAsset[] {
  if (firstImage == null || firstImage < 0 || firstImage >= records.length) return [];
  const images: ImageAsset[] = [];
  for (let i = firstImage; i < records.length; i++) {
    const mime = imageMime(records[i] ?? new Uint8Array());
    if (!mime) break;
    images.push({ mime, bytes: records[i] ?? new Uint8Array() });
  }
  return images;
}

function imageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return 'image/png';
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'GIF8') return 'image/gif';
  return null;
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

function visibleText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function headingOf(html: string): string {
  const match = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html);
  if (!match) return '';
  return visibleText(match[1] ?? '').slice(0, 80);
}

function extractBody(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1];
  return (body ?? html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

function utf8(bytes: Uint8Array | undefined): string {
  if (!bytes || bytes.length === 0) return '';
  return decodeUtf8(bytes).replace(/\0+$/g, '').trim();
}

function decodeBytes(bytes: Uint8Array, encoding: number): string {
  if (encoding === 1252) {
    try {
      return new TextDecoder('windows-1252').decode(bytes);
    } catch {
      let text = '';
      for (const byte of bytes) text += String.fromCharCode(byte);
      return text;
    }
  }
  return decodeUtf8(bytes);
}

function absoluteIndex(sectionStart: number, value: number | null): number | null {
  if (value == null || value === 0xffffffff || value > 0xffff) return null;
  return sectionStart + value;
}

function readU32(bytes: Uint8Array, offset: number, end: number): number | null {
  if (offset < 0 || offset + 4 > bytes.length || offset + 4 > end) return null;
  return u32be(bytes, offset);
}

function readU16(bytes: Uint8Array, offset: number, end: number): number | null {
  if (offset < 0 || offset + 2 > bytes.length || offset + 2 > end) return null;
  return u16be(bytes, offset);
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

function indexOfAscii(bytes: Uint8Array, text: string): number {
  outer: for (let i = 0; i + text.length <= bytes.length; i++) {
    for (let j = 0; j < text.length; j++) {
      if (bytes[i + j] !== text.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}
