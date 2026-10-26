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
};

export type ReaderFontId = 'system' | 'pingfang' | 'songti' | 'kaiti';
export type ReaderTheme = 'light' | 'sepia' | 'dark';

export type ReaderSettings = {
  fontId: ReaderFontId;
  fontSize: number;
  theme: ReaderTheme;
  verticalTraditional: boolean;
  brightness: number;
};

export const defaultReaderSettings: ReaderSettings = {
  fontId: 'system',
  fontSize: 20,
  theme: 'sepia',
  verticalTraditional: false,
  brightness: 1,
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
