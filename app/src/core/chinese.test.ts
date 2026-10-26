import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildConverter, convertHtmlText } from './chinese';

const here = path.dirname(fileURLToPath(import.meta.url));
const characters = readFileSync(path.resolve(here, '../../assets/opencc/STCharacters.txt'), 'utf8');
const phrases = readFileSync(path.resolve(here, '../../assets/opencc/STPhrases.txt'), 'utf8');
const convert = buildConverter(characters, phrases);

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
});
