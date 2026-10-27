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
    expect(html).toContain('Heiti SC');
    expect(html).toContain('Yuanti SC');
    expect(html).toContain('writing-mode: vertical-rl');
    expect(html).toContain('text-orientation: mixed');
    expect(html).toContain('verticalTraditional');
    expect(html).toContain('--safe-top');
    expect(html).toContain('--chrome-top: 46px');
    expect(html).toContain('--chrome-bottom: 72px');
    expect(html).toContain('--lh');
    expect(html).toContain('text-align: var(--align, justify)');
    expect(html).toContain('text-indent: 2em');
    expect(html).toContain('display: flow-root');
    expect(html).toContain("querySelector('.probe')");
    expect(html).toContain('letter-spacing: var(--track, 0.02em)');
    expect(html).toContain('-webkit-font-smoothing: antialiased');
    expect(html).toContain('line-break: strict');
    expect(html).toContain('zh-Hant');
    expect(html).toContain('devicePixelRatio');
    expect(html).toContain('class="booting"');
    expect(html).toContain('translate3d');
    expect(html).toContain('requestAnimationFrame');
    expect(html).toContain('rotateY');
    expect(html).toContain('preserve-3d');
    expect(html).toContain("transformStyle = 'flat'");
    expect(html).toContain('var TAP_CURL_MS = 180');
    expect(html).toContain('var HURRY_MS = 110');
    expect(html).toContain('var FADE_MS = 200');
    expect(html).toContain('prefers-reduced-motion');
    expect(html).toContain("back.className = 'face back'");
    expect(html).toContain('backgroundColor = paper');
    expect(html).toContain('pageTurn');
    expect(html).toContain('#leaf.curl-source-off');
    expect(html).toContain('opacity: 0 !important');
    expect(html).toContain("leaf.classList.add('curl-source-off')");
    expect(html).toContain("leaf.classList.remove('curl-source-off')");
    expect(html).toContain('#curl .strip.gone');
    expect(html).toContain('display: none !important');
    expect(html).toContain('#curl .strip.show-back .face.front');
    expect(html).toContain('face-clip');
    expect(html).toContain('transition: none !important');
    expect(html).toContain('under.style.clipPath');
    expect(html).toContain("strip.className = 'strip gone'");
    expect(html).toContain('var LOOKUP_MS = 460');
    expect(html).toContain('caretRangeFromPoint');
    expect(html).toContain("type: 'lookup'");
    expect(html).not.toContain('background: white');
    expect(html).not.toContain("backgroundColor = '#fff'");
    expect(html).not.toContain('backgroundColor = "white"');
  });

  it('parses the reader script', () => {
    const src = html.split('<script>').pop()?.split('</script>')[0] ?? '';
    expect(src).toContain('function buildMesh');
    expect(() => new Function(src)).not.toThrow();
  });

  it('drops blank pages and still hides the opening overlay', () => {
    expect(html).toContain('pageIsBlank');
    expect(html).toContain('这一章没有正文。');
    expect(html).toContain("statusEl.style.display = 'none'");
    expect(html).not.toContain('left: -12000px');
  });
});