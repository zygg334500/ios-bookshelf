import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildConverter, convertHtmlText } from './chinese';
import { parseAzw3 } from './azw3';
import { parseEpub } from './epub';
import { inspectBook } from './inspect';

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../../samples');
const characters = readFileSync(path.resolve(here, '../../assets/opencc/STCharacters.txt'), 'utf8');
const phrases = readFileSync(path.resolve(here, '../../assets/opencc/STPhrases.txt'), 'utf8');
const convert = buildConverter(characters, phrases);

function visible(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, '');
}

describe('sample books stay readable', () => {
  it('opens the Chinese EPUB, the traditional EPUB, and the DRM-free AZW3 with glyphs', async () => {
    const windowBook = await parseEpub(readFileSync(path.join(samples, 'window.epub')));
    const verticalBook = await parseEpub(readFileSync(path.join(samples, 'vertical-traditional.epub')));
    const azw = parseAzw3(readFileSync(path.join(samples, 'window-free.azw3')));

    expect(windowBook.chapters.length).toBeGreaterThan(1);
    expect(windowBook.toc.length).toBeGreaterThan(1);
    const simplified = windowBook.chapters.map((chapter) => visible(chapter.html)).join('');
    expect(simplified).toContain('雨下到后半夜');
    expect(simplified).toContain('第二章很短');

    const traditional = verticalBook.chapters.map((chapter) => visible(chapter.html)).join('');
    expect(traditional).toContain('窗下有雨');
    expect(traditional).toContain('繁體');

    const azwText = azw.chapters.map((chapter) => visible(chapter.html)).join('');
    expect(azw.title).toContain('无锁');
    expect(azwText).toContain('没有数字版权保护');
    expect(azwText).not.toContain('kindle:flow');

    const upright = convertHtmlText(windowBook.chapters[0]?.html ?? '', convert);
    expect(visible(upright)).toContain('雨');
    expect(visible(upright).length).toBeGreaterThan(40);
    expect(visible(convertHtmlText(verticalBook.chapters[0]?.html ?? '', convert))).toContain('窗下有雨');
  });

  it('keeps the English PDF as a fixed document with its sentences', async () => {
    const bytes = readFileSync(path.join(samples, 'notes.pdf'));
    const text = bytes.toString('latin1');
    expect(text).toContain('Notes from a paper shelf');
    expect(text).toContain('If you can read this, PDF.js rendered the fixture.');
    const book = await inspectBook('notes.pdf', bytes);
    expect(book.format).toBe('pdf');
    expect(book.pdfBytes?.length).toBe(bytes.length);
  });
});
