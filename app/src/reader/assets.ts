import { Asset } from 'expo-asset';
import { Platform } from 'react-native';
import shellModule from '../../assets/reader/engine.readerhtml';
import pdfModule from '../../assets/pdfjs/pdf.min.pdfjs';
import workerModule from '../../assets/pdfjs/pdf.worker.min.pdfjs';
import charactersModule from '../../assets/opencc/STCharacters.txt';
import phrasesModule from '../../assets/opencc/STPhrases.txt';
import { buildConverter } from '../core/chinese';

async function readAssetText(moduleId: number): Promise<string> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (!uri) throw new Error('阅读器资源没有就绪。');
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('阅读器资源下载失败。');
    return response.text();
  }
  const { File } = await import('expo-file-system');
  return new File(uri).text();
}

export async function readAssetBytes(moduleId: number): Promise<Uint8Array> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (!uri) throw new Error('示例书资源没有就绪。');
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('示例书下载失败。');
    return new Uint8Array(await response.arrayBuffer());
  }
  const { File } = await import('expo-file-system');
  return new File(uri).bytes();
}

function escapeScript(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script');
}

let shellCache: Promise<string> | null = null;

export function loadReaderHtml(): Promise<string> {
  if (!shellCache) {
    shellCache = (async () => {
      const [html, pdfjs, worker] = await Promise.all([
        readAssetText(shellModule),
        readAssetText(pdfModule),
        readAssetText(workerModule),
      ]);
      return html
        .replace('___BOOKSHELF_PDFJS___', escapeScript(pdfjs))
        .replace('___BOOKSHELF_PDFWORKER___', escapeScript(worker));
    })().catch((error) => {
      shellCache = null;
      throw error;
    });
  }
  return shellCache;
}

let converterCache: Promise<(text: string) => string> | null = null;

export function loadConverter(): Promise<(text: string) => string> {
  if (!converterCache) {
    converterCache = (async () => {
      const [characters, phrases] = await Promise.all([
        readAssetText(charactersModule),
        readAssetText(phrasesModule),
      ]);
      return buildConverter(characters, phrases);
    })().catch((error) => {
      converterCache = null;
      throw error;
    });
  }
  return converterCache;
}
