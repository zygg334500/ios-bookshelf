import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(join(process.cwd(), 'assets/reader/engine.readerhtml'), 'utf8');

describe('reader engine', () => {
  it('keeps a CJK font stack on every run of text', () => {
    expect(html).toContain('PingFang SC');
    expect(html).toContain('Songti SC');
    expect(html).toContain('Noto Serif CJK SC');
    expect(html).toContain('font-family: var(--font) !important');
    expect(html).toContain('color: var(--ink) !important');
    expect(html).toContain('-webkit-text-fill-color: var(--ink) !important');
    expect(html).toContain('writing-mode: vertical-rl');
    expect(html).not.toMatch(/transform-style:\s*preserve-3d/);
    expect(html).toContain("transformStyle = 'flat'");
  });

  it('drops blank pages and still hides the opening overlay', () => {
    expect(html).toContain('pageIsBlank');
    expect(html).toContain('这一章没有正文。');
    expect(html).toContain("statusEl.style.display = 'none'");
    expect(html).not.toContain('left: -12000px');
  });
});