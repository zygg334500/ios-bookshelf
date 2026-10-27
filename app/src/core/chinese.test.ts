import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildConverter, convertHtmlText } from './chinese';

const here = path.dirname(fileURLToPath(import.meta.url));
const characters = readFileSync(path.resolve(here, '../../assets/opencc/STCharacters.txt'), 'utf8');
const phrases = readFileSync(path.resolve(here, '../../assets/opencc/STPhrases.txt'), 'utf8');
const tsCharacters = readFileSync(path.resolve(here, '../../assets/opencc/TSCharacters.txt'), 'utf8');
const tsPhrases = readFileSync(path.resolve(here, '../../assets/opencc/TSPhrases.txt'), 'utf8');
const overlay = readFileSync(path.resolve(here, '../../assets/opencc/ClassicalOverlay.txt'), 'utf8');
const convert = buildConverter(characters, phrases);
const toHans = buildConverter(tsCharacters, tsPhrases);
const toClassical = buildConverter(characters, phrases, overlay);

describe('simplified to traditional', () => {
  it('converts common characters with the OpenCC tables', () => {
    expect(convert('书架')).toBe('書架');
    expect(convert('软件')).toBe('軟件');
    expect(convert('这是一个测试')).toBe('這是一個測試');
  });

  it('leaves an already traditional sentence unchanged', () => {
    expect(convert('窗下有雨')).toBe('窗下有雨');
  });

  it('converts text nodes and keeps tags', () => {
    expect(convertHtmlText('<p class="书">书与灯</p>', convert)).toBe('<p class="书">書與燈</p>');
  });

  it('converts traditional phrases and characters back to simplified', () => {
    expect(toHans('書架')).toBe('书架');
    expect(toHans('一目瞭然')).toBe('一目了然');
    expect(toHans('這是一個測試')).toBe('这是一个测试');
  });

  it('keeps literary characters in classical mode while phrases still convert', () => {
    expect(toClassical('余')).toBe('余');
    expect(toClassical('云')).toBe('云');
    expect(convert('余')).toBe('餘');
    expect(toClassical('剩余')).toBe('剩餘');
    expect(toClassical('云彩')).toBe('雲彩');
    expect(toClassical('这是一个测试')).toBe('這是一個測試');
  });
});
