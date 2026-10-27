import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { toBase64 } from '../core/binary';
import { convertHtmlText } from '../core/chinese';
import type { LoadedBook, ReaderSettings } from '../core/types';
import { shelf, paperColors } from '../ui/theme';
import { loadConverter, loadReaderHtml } from './assets';

export type ReaderInsets = { top: number; right: number; bottom: number; left: number };

export type ReaderProgress = {
  chapterIndex: number;
  pageIndex: number;
  pageCount: number;
  chapterCount: number;
  progress: number;
  chapterTitle: string;
};

type Props = {
  book: LoadedBook;
  settings: ReaderSettings;
  initialChapter: number;
  initialPage: number;
  seekNonce: number;
  seekProgress: number | null;
  insets: ReaderInsets;
  onProgress: (progress: ReaderProgress) => void;
  onChrome: () => void;
  onCover: (dataUrl: string) => void;
  onError: (message: string) => void;
};

type OutMessage = {
  source?: string;
  type?: string;
  chapterIndex?: number;
  pageIndex?: number;
  pageCount?: number;
  chapterCount?: number;
  progress?: number;
  chapterTitle?: string;
  dataUrl?: string;
  message?: string;
};

export function ReaderPane({
  book,
  settings,
  initialChapter,
  initialPage,
  seekNonce,
  seekProgress,
  insets,
  onProgress,
  onChrome,
  onCover,
  onError,
}: Props) {
  const webRef = useRef<WebView<{ marker?: true }>>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const bookRef = useRef(book);
  bookRef.current = book;
  const insetsRef = useRef(insets);
  insetsRef.current = insets;

  useEffect(() => {
    let cancelled = false;
    loadReaderHtml()
      .then((value) => {
        if (!cancelled) setHtml(value);
      })
      .catch((error: unknown) => onError(error instanceof Error ? error.message : '阅读器加载失败。'));
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const post = (message: object) => {
    const raw = JSON.stringify(message);
    if (Platform.OS === 'web') {
      frameRef.current?.contentWindow?.postMessage(raw, '*');
      return;
    }
    webRef.current?.postMessage(raw);
  };

  const sendLoad = async () => {
    const current = bookRef.current;
    const currentSettings = settingsRef.current;
    const frame = insetsRef.current;
    if (current.format === 'pdf' && current.pdfBytes) {
      const encoded = toBase64(current.pdfBytes);
      if (encoded.length > 1_400_000) {
        post({
          type: 'pdf-begin',
          settings: currentSettings,
          insets: frame,
          position: { chapterIndex: initialChapter, pageIndex: initialPage },
        });
        const size = 180_000;
        for (let i = 0; i < encoded.length; i += size) {
          post({ type: 'pdf-chunk', data: encoded.slice(i, i + size) });
        }
        post({ type: 'pdf-end' });
        return;
      }
      post({
        type: 'load',
        settings: currentSettings,
        insets: frame,
        position: { chapterIndex: 0, pageIndex: initialPage },
        book: { kind: 'pdf', pdfBase64: encoded },
      });
      return;
    }
    let chapters = current.chapters;
    if (currentSettings.traditional && current.format !== 'pdf') {
      const convert = await loadConverter();
      chapters = chapters.map((chapter) => ({
        ...chapter,
        title: convert(chapter.title),
        html: convertHtmlText(chapter.html, convert),
      }));
    }
    post({
      type: 'load',
      settings: currentSettings,
      insets: frame,
      position: { chapterIndex: initialChapter, pageIndex: initialPage },
      book: {
        kind: 'html',
        chapters: chapters.map((chapter) => ({
          title: chapter.title,
          html: chapter.html,
          styles: chapter.styles,
        })),
      },
    });
  };

  useEffect(() => {
    if (!ready) return;
    void sendLoad();
    // Reload when the book or the vertical mode changes the HTML itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, book, settings.traditional]);

  useEffect(() => {
    if (!ready) return;
    post({ type: 'settings', settings });
  }, [ready, settings]);

  useEffect(() => {
    if (!ready) return;
    post({ type: 'insets', ...insets });
  }, [ready, insets.top, insets.right, insets.bottom, insets.left]);

  useEffect(() => {
    if (!ready || seekProgress == null || seekNonce === 0) return;
    post({ type: 'goto', progress: seekProgress });
  }, [ready, seekNonce, seekProgress]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      handleRaw(event.data);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onChrome, onCover, onError, onProgress]);

  const handleRaw = (raw: string) => {
    let message: OutMessage;
    try {
      message = JSON.parse(raw) as OutMessage;
    } catch {
      return;
    }
    if (message.source !== 'bookshelf' || !message.type) return;
    if (message.type === 'ready') {
      readyRef.current = true;
      setReady(true);
    } else if (message.type === 'progress') {
      onProgress({
        chapterIndex: message.chapterIndex ?? 0,
        pageIndex: message.pageIndex ?? 0,
        pageCount: message.pageCount ?? 1,
        chapterCount: message.chapterCount ?? 1,
        progress: message.progress ?? 0,
        chapterTitle: message.chapterTitle ?? '',
      });
    } else if (message.type === 'chrome') {
      onChrome();
    } else if (message.type === 'cover' && message.dataUrl) {
      onCover(message.dataUrl);
    } else if (message.type === 'error' && message.message) {
      onError(message.message);
    }
  };

  const paper = paperColor(settings.theme);

  if (!html) {
    return (
      <View style={[styles.loading, { backgroundColor: paper }]}>
        <ActivityIndicator color={paperColors(settings.theme).ink} />
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.fill, { backgroundColor: paper }]}>
        <iframe
          ref={frameRef}
          title="reader"
          srcDoc={html}
          onLoad={() => {
            readyRef.current = false;
            setReady(false);
            frameRef.current?.contentWindow?.postMessage(JSON.stringify({ type: 'hello' }), '*');
          }}
          style={{ border: 'none', width: '100%', height: '100%', background: paper }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: paper }]}>
      <WebView<{ marker?: true }>
        ref={webRef}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'about:blank' }}
        onMessage={(event: WebViewMessageEvent) => handleRaw(event.nativeEvent.data)}
        onLoad={() => {
          readyRef.current = false;
          setReady(false);
          webRef.current?.postMessage(JSON.stringify({ type: 'hello' }));
        }}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        bounces={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        androidLayerType="hardware"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        setSupportMultipleWindows={false}
        textInteractionEnabled={false}
        style={styles.web}
        containerStyle={{ flex: 1, backgroundColor: paper }}
      />
    </View>
  );
}

function paperColor(theme: string): string {
  if (theme === 'dark' || theme === 'light' || theme === 'sepia') return paperColors(theme).paper;
  return paperColors('sepia').paper;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  web: { flex: 1, backgroundColor: 'transparent' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
