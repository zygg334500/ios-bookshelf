import { sniffFormat } from './binary';
import { parseAzw3 } from './azw3';
import { parseEpub } from './epub';
import { BookError, type LoadedBook } from './types';

export async function inspectBook(fileName: string, bytes: Uint8Array): Promise<LoadedBook> {
  const format = sniffFormat(fileName, bytes);
  if (!format) {
    throw new BookError('FORMAT', '只支持 PDF、EPUB 和无 DRM 的 AZW3。');
  }
  if (format === 'pdf') {
    const title = fileName.replace(/\.pdf$/i, '') || 'PDF';
    return {
      format: 'pdf',
      title,
      author: 'PDF',
      chapters: [],
      toc: [],
      pdfBytes: bytes,
    };
  }
  if (format === 'epub') {
    try {
      return await parseEpub(bytes);
    } catch (error) {
      if (error instanceof BookError) throw error;
      throw new BookError('FORMAT', 'EPUB 解析失败。文件可能不完整。');
    }
  }
  try {
    return parseAzw3(bytes);
  } catch (error) {
    if (error instanceof BookError) throw error;
    throw new BookError('FORMAT', '这本 AZW3 无法解析。BookShelf 只读取无 DRM 的文件，不会尝试解除保护。');
  }
}
