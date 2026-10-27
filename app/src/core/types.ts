export type BookFormat = 'pdf' | 'epub' | 'azw3';

export type Chapter = {
  id: string;
  title: string;
  html: string;
  styles: string;
};

export type TocItem = {
  title: string;
  chapterIndex: number;
};

export type LoadedBook = {
  format: BookFormat;
  title: string;
  author: string;
  chapters: Chapter[];
  toc: TocItem[];
  coverBytes?: Uint8Array;
  coverMime?: string;
  /** Present for PDF. EPUB and AZW3 are already converted to chapters. */
  pdfBytes?: Uint8Array;
};

export type ReadingMark = 'auto' | 'reading' | 'finished';

export type BookRecord = {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  fileName: string;
  addedAt: number;
  lastOpenedAt: number | null;
  chapterIndex: number;
  pageIndex: number;
  progress: number;
  coverName: string | null;
  /** auto follows progress; reading / finished are explicit. */
  readingMark: ReadingMark;
};

export type ReaderFontId = 'system' | 'pingfang' | 'songti' | 'heiti' | 'kaiti' | 'yuanti';
export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type ReaderAlign = 'left' | 'justify' | 'center';
export type PageTurnMode = 'curl' | 'slide' | 'none';
/** 原文 keeps the file. 简体 / 繁体 are OpenCC. 古文 is traditional plus literary overrides. */
export type ReaderScript = 'original' | 'hans' | 'hant' | 'classical';

export type ReaderSettings = {
  fontId: ReaderFontId;
  fontSize: number;
  lineHeight: number;
  /** Extra horizontal padding inside the safe area, in px. */
  margin: number;
  align: ReaderAlign;
  theme: ReaderTheme;
  /** 竖排. Independent of simplified-to-traditional conversion. */
  vertical: boolean;
  /** 简转繁. True for 繁体 and 古文. Kept so older saves and the WebView font stack still apply. */
  traditional: boolean;
  /** 原文 / 简体 / 繁体 / 古文. Wins over the legacy `traditional` flag when present. */
  script: ReaderScript;
  brightness: number;
  /** 卷页 / 滑动 / 无. Reduced motion always uses a short crossfade. */
  pageTurn: PageTurnMode;
};

export const defaultReaderSettings: ReaderSettings = {
  fontId: 'system',
  fontSize: 20,
  lineHeight: 1.7,
  margin: 22,
  align: 'justify',
  theme: 'sepia',
  vertical: false,
  traditional: false,
  script: 'original',
  brightness: 1,
  pageTurn: 'curl',
};

export class BookError extends Error {
  readonly code: 'DRM' | 'UNSUPPORTED' | 'FORMAT';

  constructor(code: 'DRM' | 'UNSUPPORTED' | 'FORMAT', message: string) {
    super(message);
    this.name = 'BookError';
    this.code = code;
  }
}

export const DRM_MESSAGE =
  '此文件受数字版权保护（DRM），BookShelf 无法打开。本应用只读取无 DRM 的 AZW3 / KF8，不会尝试解除保护。请改用你有权阅读的 EPUB、PDF，或出版社提供的无 DRM 文件。';
