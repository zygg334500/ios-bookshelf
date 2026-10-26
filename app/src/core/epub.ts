import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { mimeFromName, toBase64 } from './binary';
import { BookError, type Chapter, type LoadedBook, type TocItem } from './types';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  textNodeName: '#text',
  isArray: (name) =>
    ['item', 'itemref', 'navPoint', 'li', 'meta', 'rootfile', 'reference', 'a'].includes(name),
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node).trim();
  if (Array.isArray(node)) return textOf(node[0]);
  if (typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (typeof record['#text'] === 'string' || typeof record['#text'] === 'number') {
      return String(record['#text']).trim();
    }
  }
  return '';
}

function attr(node: unknown, name: string): string {
  if (!node || typeof node !== 'object') return '';
  const value = (node as Record<string, unknown>)[`@_${name}`];
  return value == null ? '' : String(value);
}

function resolvePath(baseFile: string, href: string): string {
  const clean = href.split('#')[0]?.split('?')[0] ?? '';
  if (!clean) return baseFile;
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    decoded = clean;
  }
  const stack = baseFile.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

async function zipFile(zip: JSZip, path: string): Promise<Uint8Array | null> {
  const file = zip.file(path) ?? zip.file(path.replace(/^\/+/, ''));
  if (!file) return null;
  const data = await file.async('uint8array');
  return data;
}

function stripScripts(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

async function rewriteCssUrls(css: string, base: string, zip: JSZip): Promise<string> {
  const matches = [...css.matchAll(/url\(([^)]+)\)/g)];
  if (matches.length === 0) return css;
  let out = '';
  let last = 0;
  for (const match of matches) {
    const index = match.index ?? 0;
    out += css.slice(last, index);
    last = index + match[0].length;
    const raw = match[1].trim().replace(/^['"]|['"]$/g, '');
    if (/^(data:|https?:|blob:|#)/i.test(raw)) {
      out += match[0];
      continue;
    }
    const bytes = await zipFile(zip, resolvePath(base, raw));
    if (!bytes) {
      out += match[0];
      continue;
    }
    out += `url("data:${mimeFromName(raw)};base64,${toBase64(bytes)}")`;
  }
  out += css.slice(last);
  return out;
}

async function inlineHtml(html: string, base: string, zip: JSZip): Promise<string> {
  const matches = [...html.matchAll(/<img\b[^>]*>/gi)];
  if (matches.length === 0) return html;
  let out = '';
  let last = 0;
  for (const match of matches) {
    const index = match.index ?? 0;
    out += html.slice(last, index);
    last = index + match[0].length;
    const tag = match[0];
    const srcMatch = /\ssrc\s*=\s*(['"])(.*?)\1/i.exec(tag);
    if (!srcMatch) {
      out += tag;
      continue;
    }
    const src = srcMatch[2];
    if (/^(data:|https?:|blob:)/i.test(src)) {
      out += tag;
      continue;
    }
    const bytes = await zipFile(zip, resolvePath(base, src));
    if (!bytes) {
      out += tag;
      continue;
    }
    const dataUrl = `data:${mimeFromName(src)};base64,${toBase64(bytes)}`;
    out += tag.replace(srcMatch[0], ` src=${srcMatch[1]}${dataUrl}${srcMatch[1]}`);
  }
  out += html.slice(last);
  return out;
}

function extractDocument(xhtml: string): { body: string; styles: string; links: string[] } {
  const styles = [...xhtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const links = [...xhtml.matchAll(/<link\b[^>]*>/gi)]
    .map((tag) => {
      const rel = /rel\s*=\s*(['"])(.*?)\1/i.exec(tag[0])?.[2] ?? '';
      const href = /href\s*=\s*(['"])(.*?)\1/i.exec(tag[0])?.[2] ?? '';
      if (!/stylesheet/i.test(rel) || !href) return '';
      return href;
    })
    .filter(Boolean);
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(xhtml)?.[1] ?? xhtml;
  return { body: stripScripts(body), styles, links };
}

type ManifestItem = {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
};

export async function parseEpub(data: Uint8Array): Promise<LoadedBook> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new BookError('FORMAT', '这个 EPUB 已损坏，无法解压。');
  }
  const container = await zipFile(zip, 'META-INF/container.xml');
  if (!container) throw new BookError('FORMAT', 'EPUB 缺少 META-INF/container.xml。');
  const containerXml = parser.parse(new TextDecoder().decode(container)) as {
    container?: { rootfiles?: { rootfile?: unknown } };
  };
  const rootfile = asArray(containerXml.container?.rootfiles?.rootfile)[0];
  const opfPath = attr(rootfile, 'full-path');
  if (!opfPath) throw new BookError('FORMAT', 'EPUB 没有 OPF 路径。');
  const opfBytes = await zipFile(zip, opfPath);
  if (!opfBytes) throw new BookError('FORMAT', '找不到 EPUB 的 OPF 文件。');
  const opf = parser.parse(new TextDecoder().decode(opfBytes)) as {
    package?: {
      metadata?: Record<string, unknown>;
      manifest?: { item?: unknown };
      spine?: { itemref?: unknown };
    };
  };
  const metadata = opf.package?.metadata ?? {};
  const title = textOf(metadata.title) || '未命名';
  const author = textOf(metadata.creator) || '佚名';
  const manifest = new Map<string, ManifestItem>();
  for (const item of asArray(opf.package?.manifest?.item)) {
    const id = attr(item, 'id');
    const href = attr(item, 'href');
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      href: resolvePath(opfPath, href),
      mediaType: attr(item, 'media-type'),
      properties: attr(item, 'properties'),
    });
  }
  const spine = asArray(opf.package?.spine?.itemref)
    .map((ref) => manifest.get(attr(ref, 'idref')))
    .filter((item): item is ManifestItem => Boolean(item))
    .filter((item) => /xhtml|html|xml/i.test(item.mediaType) || /\.x?html?$/i.test(item.href));

  if (spine.length === 0) throw new BookError('FORMAT', 'EPUB 目录里没有可阅读的章节。');

  const chapters: Chapter[] = [];
  for (const [index, item] of spine.entries()) {
    const raw = await zipFile(zip, item.href);
    if (!raw) continue;
    const text = new TextDecoder().decode(raw);
    const extracted = extractDocument(text);
    let styles = extracted.styles;
    for (const link of extracted.links) {
      const cssPath = resolvePath(item.href, link);
      const css = await zipFile(zip, cssPath);
      if (css) styles += `\n${new TextDecoder().decode(css)}`;
    }
    styles = await rewriteCssUrls(styles, item.href, zip);
    const html = await inlineHtml(extracted.body, item.href, zip);
    chapters.push({
      id: item.id || `c${index}`,
      title: `第 ${chapters.length + 1} 章`,
      html,
      styles,
    });
  }
  if (chapters.length === 0) throw new BookError('FORMAT', 'EPUB 章节是空的。');

  const toc = await readToc(zip, opfPath, manifest, chapters);
  for (const item of toc) {
    if (chapters[item.chapterIndex] && item.title) {
      chapters[item.chapterIndex].title = item.title;
    }
  }

  const cover = await readCover(zip, metadata, manifest);
  return {
    format: 'epub',
    title,
    author,
    chapters,
    toc: toc.length > 0 ? toc : chapters.map((chapter, chapterIndex) => ({ title: chapter.title, chapterIndex })),
    coverBytes: cover?.bytes,
    coverMime: cover?.mime,
  };
}

async function readToc(
  zip: JSZip,
  opfPath: string,
  manifest: Map<string, ManifestItem>,
  chapters: Chapter[],
): Promise<TocItem[]> {
  const navItem = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes('nav'));
  if (navItem) {
    const raw = await zipFile(zip, navItem.href);
    if (raw) {
      const doc = parser.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
      const links = collectAnchors(doc);
      const items = links
        .map((link) => ({
          title: link.title,
          chapterIndex: chapterIndexForHref(navItem.href, link.href, chapters, manifest),
        }))
        .filter((item) => item.chapterIndex >= 0 && item.title);
      if (items.length > 0) return dedupeToc(items);
    }
  }
  const ncx = [...manifest.values()].find((item) => item.mediaType.includes('dtbncx') || item.href.endsWith('.ncx'));
  if (!ncx) return [];
  const raw = await zipFile(zip, ncx.href);
  if (!raw) return [];
  const doc = parser.parse(new TextDecoder().decode(raw)) as {
    ncx?: { navMap?: { navPoint?: unknown } };
  };
  const points = asArray(doc.ncx?.navMap?.navPoint);
  const items: TocItem[] = [];
  const walk = (pointsToWalk: unknown[]) => {
    for (const point of pointsToWalk) {
      const record = point as { navLabel?: unknown; content?: unknown; navPoint?: unknown };
      const title = textOf((record.navLabel as { text?: unknown } | undefined)?.text);
      const src = attr(record.content, 'src');
      const chapterIndex = chapterIndexForHref(ncx.href, src, chapters, manifest);
      if (title && chapterIndex >= 0) items.push({ title, chapterIndex });
      walk(asArray(record.navPoint));
    }
  };
  walk(points);
  return dedupeToc(items);
}

function collectAnchors(node: unknown, out: { title: string; href: string }[] = []): { title: string; href: string }[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectAnchors(item, out);
    return out;
  }
  const record = node as Record<string, unknown>;
  if (typeof record['@_href'] === 'string') {
    const title = textOf(record['#text'] ?? record);
    if (title) out.push({ title, href: String(record['@_href']) });
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') collectAnchors(value, out);
  }
  return out;
}

function chapterIndexForHref(
  base: string,
  href: string,
  chapters: Chapter[],
  manifest: Map<string, ManifestItem>,
): number {
  if (!href) return -1;
  const path = resolvePath(base, href);
  const index = [...manifest.values()].findIndex((item) => item.href === path);
  if (index >= 0 && index < chapters.length) {
    const byId = chapters.findIndex((chapter) => chapter.id === [...manifest.values()][index]?.id);
    if (byId >= 0) return byId;
  }
  return chapters.findIndex((chapter) => {
    const item = [...manifest.values()].find((entry) => entry.id === chapter.id);
    return item?.href === path;
  });
}

function dedupeToc(items: TocItem[]): TocItem[] {
  const seen = new Set<string>();
  const out: TocItem[] = [];
  for (const item of items) {
    const key = `${item.chapterIndex}:${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function readCover(
  zip: JSZip,
  metadata: Record<string, unknown>,
  manifest: Map<string, ManifestItem>,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const metas = asArray(metadata.meta);
  const coverId = metas.map((meta) => (attr(meta, 'name') === 'cover' ? attr(meta, 'content') : '')).find(Boolean);
  const item =
    (coverId ? manifest.get(coverId) : undefined) ??
    [...manifest.values()].find((entry) => entry.properties.split(/\s+/).includes('cover-image'));
  if (!item) return null;
  if (!/^image\//.test(item.mediaType) && !/\.(png|jpe?g|gif|webp)$/i.test(item.href)) return null;
  const bytes = await zipFile(zip, item.href);
  if (!bytes) return null;
  return { bytes, mime: item.mediaType || mimeFromName(item.href) };
}
