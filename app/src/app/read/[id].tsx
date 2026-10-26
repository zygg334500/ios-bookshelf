import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { readingStatus, readingStatusLabel } from '../../core/shelf';
import { normalizeReaderSettings } from '../../core/settings';
import { BookError, type LoadedBook, type ReaderAlign, type ReaderFontId, type ReaderSettings, type ReaderTheme } from '../../core/types';
import { ReaderPane, type ReaderProgress } from '../../reader/ReaderPane';
import { useLibrary } from '../../storage/library';
import { bottomChromePadding, topChromePadding } from '../../ui/insets';
import { fonts, paperColors, shelf } from '../../ui/theme';

const FONT_CHOICES: { id: ReaderFontId; label: string }[] = [
  { id: 'system', label: '系统' },
  { id: 'pingfang', label: '苹方' },
  { id: 'songti', label: '宋体' },
  { id: 'heiti', label: '黑体' },
  { id: 'kaiti', label: '楷体' },
  { id: 'yuanti', label: '圆体' },
];

const THEME_CHOICES: { id: ReaderTheme; label: string }[] = [
  { id: 'light', label: '日间' },
  { id: 'sepia', label: '羊皮纸' },
  { id: 'dark', label: '夜间' },
];

const ALIGN_CHOICES: { id: ReaderAlign; label: string }[] = [
  { id: 'left', label: '左对齐' },
  { id: 'justify', label: '两端' },
  { id: 'center', label: '居中' },
];

const MARGIN_CHOICES: { value: number; label: string }[] = [
  { value: 12, label: '窄' },
  { value: 22, label: '适中' },
  { value: 34, label: '宽' },
  { value: 46, label: '更宽' },
];

export default function ReadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookId = String(id ?? '');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = Math.min(520, Math.max(280, Math.round(windowHeight * 0.58)));
  const library = useLibrary();
  const record = library.books.find((book) => book.id === bookId);
  const settings = library.bookSettings[bookId] ?? library.settings;
  const scopedToBook = Boolean(library.bookSettings[bookId]);
  const [loaded, setLoaded] = useState<LoadedBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showChrome, setShowChrome] = useState(true);
  const [panel, setPanel] = useState<'none' | 'settings' | 'toc'>('none');
  const [progress, setProgress] = useState<ReaderProgress | null>(null);
  const [seek, setSeek] = useState<{ nonce: number; progress: number | null }>({ nonce: 0, progress: null });
  const [barWidth, setBarWidth] = useState(1);
  const chromeOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(chromeOpacity, {
      toValue: showChrome ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [chromeOpacity, showChrome]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    void library
      .loadBook(bookId)
      .then((book) => {
        if (!cancelled) setLoaded(book);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof BookError || err instanceof Error ? err.message : '打不开这本书。');
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, library.loadBook]);

  const savePosition = useRef(library.savePosition);
  savePosition.current = library.savePosition;
  useEffect(() => {
    if (!progress || !bookId) return;
    const timer = setTimeout(() => {
      void savePosition.current(bookId, progress.chapterIndex, progress.pageIndex, progress.progress);
    }, 400);
    return () => clearTimeout(timer);
  }, [bookId, progress]);

  const colors = paperColors(settings.theme);
  const dim = 1 - settings.brightness;
  const patch = (partial: Partial<ReaderSettings>) => {
    void library.updateSettings(normalizeReaderSettings({ ...settings, ...partial }), scopedToBook ? bookId : undefined);
  };

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: shelf.bg, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }]}>
        <StatusBar style="dark" />
        <Text style={styles.errorTitle}>{error.includes('受数字版权保护') ? '有 DRM 的书' : '打不开'}</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>返回书架</Text>
        </Pressable>
      </View>
    );
  }

  if (!loaded || !record) {
    return (
      <View style={[styles.center, { backgroundColor: colors.paper, paddingTop: insets.top }]}>
        <StatusBar style={settings.theme === 'dark' ? 'light' : 'dark'} />
        <ActivityIndicator color={shelf.accent} />
        <Text style={{ marginTop: 12, color: colors.ink, fontFamily: fonts.ui }}>正在排版…</Text>
      </View>
    );
  }

  const status = readingStatus({
    progress: progress?.progress ?? record.progress,
    lastOpenedAt: record.lastOpenedAt,
    readingMark: record.readingMark,
  });
  const finished = status === 'finished';
  const bookmarked = (library.bookmarks[bookId] ?? []).some(
    (mark) => progress && mark.chapterIndex === progress.chapterIndex && mark.pageIndex === progress.pageIndex,
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <StatusBar style={settings.theme === 'dark' ? 'light' : 'dark'} />
      <ReaderPane
        book={loaded}
        settings={settings}
        initialChapter={record.chapterIndex}
        initialPage={record.pageIndex}
        seekNonce={seek.nonce}
        seekProgress={seek.progress}
        insets={insets}
        onProgress={setProgress}
        onChrome={() => {
          setShowChrome((value) => !value);
          setPanel('none');
        }}
        onCover={(dataUrl) => void library.saveCover(bookId, dataUrl)}
        onError={setError}
      />
      {dim > 0.01 ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${dim})` }]} /> : null}
      <Animated.View
        pointerEvents={showChrome ? 'auto' : 'none'}
        style={[
          styles.topBar,
          {
            paddingTop: topChromePadding(insets),
            paddingLeft: Math.max(insets.left, 16),
            paddingRight: Math.max(insets.right, 16),
            backgroundColor: colors.paper,
            opacity: chromeOpacity,
            transform: [{ translateY: chromeOpacity.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
          },
        ]}
      >
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={[styles.barText, { color: colors.ink }]}>书架</Text>
        </Pressable>
        <Text numberOfLines={1} style={[styles.barTitle, { color: colors.ink }]}>
          {loaded.title}
        </Text>
        <Pressable
          hitSlop={8}
          onPress={() => {
            if (!progress) return;
            void library.toggleBookmark(bookId, {
              chapterIndex: progress.chapterIndex,
              pageIndex: progress.pageIndex,
              progress: progress.progress,
              label: progress.chapterTitle || loaded.title,
            });
          }}
        >
          <Text style={[styles.barText, { color: colors.ink }]}>{bookmarked ? '取消书签' : '书签'}</Text>
        </Pressable>
        <Pressable hitSlop={8} onPress={() => setPanel(panel === 'toc' ? 'none' : 'toc')}>
          <Text style={[styles.barText, { color: colors.ink }]}>目录</Text>
        </Pressable>
      </Animated.View>
      <Animated.View
        pointerEvents={showChrome ? 'auto' : 'none'}
        style={[
          styles.bottomBar,
          {
            paddingBottom: bottomChromePadding(insets),
            paddingLeft: Math.max(insets.left, 16),
            paddingRight: Math.max(insets.right, 16),
            backgroundColor: colors.paper,
            opacity: chromeOpacity,
            transform: [{ translateY: chromeOpacity.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
          },
        ]}
      >
        <Text style={[styles.meta, { color: colors.ink }]}>
          {progress
            ? `${readingStatusLabel(status)} · ${progress.chapterTitle || '正文'} · ${progress.pageIndex + 1}/${Math.max(progress.pageCount, 1)}`
            : '左右滑动翻页，点页面中间收起菜单'}
        </Text>
        <Pressable
          style={styles.slider}
          onLayout={(event) => setBarWidth(event.nativeEvent.layout.width || 1)}
          onPress={(event) => {
            const ratio = Math.min(0.999, Math.max(0, event.nativeEvent.locationX / barWidth));
            setSeek({ nonce: Date.now(), progress: ratio });
          }}
        >
          <View style={[styles.sliderTrack, { backgroundColor: colors.track }]}>
            <View style={[styles.sliderFill, { width: `${Math.round((progress?.progress ?? record.progress) * 100)}%` }]} />
          </View>
        </Pressable>
        <View style={styles.row}>
          <Pressable onPress={() => void library.markBook(bookId, finished ? 'reading' : 'finished')}>
            <Text style={[styles.barText, { color: colors.ink }]}>{finished ? '标为在读' : '标为读完'}</Text>
          </Pressable>
          <Pressable onPress={() => setPanel(panel === 'settings' ? 'none' : 'settings')}>
            <Text style={[styles.barText, { color: colors.ink }]}>Aa 排版</Text>
          </Pressable>
        </View>
      </Animated.View>
      {panel === 'settings' ? (
        <View style={[styles.sheet, { left: Math.max(insets.left, 12), right: Math.max(insets.right, 12), bottom: Math.max(insets.bottom, 8), height: sheetHeight, backgroundColor: colors.paper }]}>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            <Text style={[styles.sheetTitle, { color: colors.ink }]}>排版</Text>
            <View style={styles.row}>
              <Pressable onPress={() => void library.clearBookSettings(bookId)} style={[styles.chip, !scopedToBook && styles.chipOn]}>
                <Text style={styles.chipText}>全部书籍</Text>
              </Pressable>
              <Pressable onPress={() => void library.updateSettings(settings, bookId)} style={[styles.chip, scopedToBook && styles.chipOn]}>
                <Text style={styles.chipText}>仅本书</Text>
              </Pressable>
            </View>
            <Text style={styles.note}>
              {scopedToBook ? '现在的字号、字体、行距和竖排只留给这本书。' : '改动会用到书架上还没有单独排版的书。'}
            </Text>
            <Text style={[styles.label, { color: colors.ink }]}>字体</Text>
            <View style={styles.row}>
              {FONT_CHOICES.map((choice) => (
                <Pressable key={choice.id} onPress={() => patch({ fontId: choice.id })} style={[styles.chip, settings.fontId === choice.id && styles.chipOn]}>
                  <Text style={styles.chipText}>{choice.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.label, { color: colors.ink }]}>字号</Text>
            <View style={styles.row}>
              <Pressable onPress={() => patch({ fontSize: settings.fontSize - 1 })} style={styles.chip}>
                <Text style={styles.chipText}>A-</Text>
              </Pressable>
              <Text style={{ color: colors.ink, fontFamily: fonts.ui }}>{settings.fontSize}</Text>
              <Pressable onPress={() => patch({ fontSize: settings.fontSize + 1 })} style={styles.chip}>
                <Text style={styles.chipText}>A+</Text>
              </Pressable>
            </View>
            <Text style={[styles.label, { color: colors.ink }]}>行距</Text>
            <View style={styles.row}>
              <Pressable onPress={() => patch({ lineHeight: Math.round(settings.lineHeight * 100 - 10) / 100 })} style={styles.chip}>
                <Text style={styles.chipText}>更紧</Text>
              </Pressable>
              <Text style={{ color: colors.ink, fontFamily: fonts.ui }}>{settings.lineHeight.toFixed(2)}</Text>
              <Pressable onPress={() => patch({ lineHeight: Math.round(settings.lineHeight * 100 + 10) / 100 })} style={styles.chip}>
                <Text style={styles.chipText}>更松</Text>
              </Pressable>
            </View>
            <Text style={[styles.label, { color: colors.ink }]}>边距</Text>
            <View style={styles.row}>
              {MARGIN_CHOICES.map((choice) => (
                <Pressable key={choice.value} onPress={() => patch({ margin: choice.value })} style={[styles.chip, settings.margin === choice.value && styles.chipOn]}>
                  <Text style={styles.chipText}>{choice.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.label, { color: colors.ink }]}>对齐</Text>
            <View style={styles.row}>
              {ALIGN_CHOICES.map((choice) => (
                <Pressable key={choice.id} onPress={() => patch({ align: choice.id })} style={[styles.chip, settings.align === choice.id && styles.chipOn]}>
                  <Text style={styles.chipText}>{choice.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.label, { color: colors.ink }]}>纸色</Text>
            <View style={styles.row}>
              {THEME_CHOICES.map((choice) => (
                <Pressable key={choice.id} onPress={() => patch({ theme: choice.id })} style={[styles.chip, settings.theme === choice.id && styles.chipOn]}>
                  <Text style={styles.chipText}>{choice.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.row}>
              <Pressable style={[styles.chip, settings.vertical && styles.chipOn]} onPress={() => patch({ vertical: !settings.vertical })}>
                <Text style={styles.chipText}>竖排 {settings.vertical ? '开' : '关'}</Text>
              </Pressable>
              <Pressable style={[styles.chip, settings.traditional && styles.chipOn]} onPress={() => patch({ traditional: !settings.traditional })}>
                <Text style={styles.chipText}>简转繁 {settings.traditional ? '开' : '关'}</Text>
              </Pressable>
            </View>
            <Text style={styles.note}>
              {loaded.format === 'pdf'
                ? 'PDF 保持原页面。字号、字体、行距、边距、对齐、竖排和简转繁对它不起作用。'
                : '竖排使用 writing-mode: vertical-rl。简转繁来自 OpenCC 字词表，原文件不改，个别多义字可能不是你要的那个。'}
            </Text>
            <Text style={[styles.note, { color: colors.ink }]}>纸面亮度 {Math.round(settings.brightness * 100)}%</Text>
            <View style={styles.row}>
              <Pressable onPress={() => patch({ brightness: Math.round((settings.brightness - 0.05) * 100) / 100 })} style={styles.chip}>
                <Text style={styles.chipText}>暗</Text>
              </Pressable>
              <Pressable onPress={() => patch({ brightness: Math.round((settings.brightness + 0.05) * 100) / 100 })} style={styles.chip}>
                <Text style={styles.chipText}>亮</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      ) : null}
      {panel === 'toc' ? (
        <View style={[styles.toc, { paddingTop: insets.top + 48, backgroundColor: colors.paper }]}>
          <ScrollView
            contentInsetAdjustmentBehavior="never"
            contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 24, gap: 8 }}
          >
            <Text style={[styles.sheetTitle, { color: colors.ink }]}>书签</Text>
            {(library.bookmarks[bookId] ?? []).length === 0 ? <Text style={styles.note}>还没有书签。阅读时点上方「书签」记住这一页。</Text> : null}
            {(library.bookmarks[bookId] ?? []).map((mark) => (
              <Pressable
                key={mark.id}
                onPress={() => {
                  setSeek({ nonce: Date.now(), progress: mark.progress });
                  setPanel('none');
                }}
              >
                <Text style={[styles.tocItem, { color: colors.ink }]}>{mark.label} · 第 {mark.pageIndex + 1} 页</Text>
              </Pressable>
            ))}
            <Text style={[styles.sheetTitle, { color: colors.ink, marginTop: 12 }]}>目录</Text>
            {(loaded.toc.length ? loaded.toc : loaded.chapters.map((chapter, chapterIndex) => ({ title: chapter.title, chapterIndex }))).map((item, index) => (
              <Pressable
                key={`${item.chapterIndex}-${index}`}
                onPress={() => {
                  const count = Math.max(loaded.chapters.length, 1);
                  setSeek({ nonce: Date.now(), progress: item.chapterIndex / count });
                  setPanel('none');
                }}
              >
                <Text style={[styles.tocItem, { color: colors.ink }]}>{item.title}</Text>
              </Pressable>
            ))}
            {loaded.format === 'pdf' ? <Text style={styles.note}>这本 PDF 没有目录，用底部进度条翻页。</Text> : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorTitle: { fontFamily: fonts.display, fontSize: 32, color: shelf.ink, marginBottom: 8 },
  errorBody: { fontFamily: fonts.ui, color: shelf.muted, lineHeight: 22, textAlign: 'center' },
  backButton: { marginTop: 18, backgroundColor: shelf.ink, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  backButtonText: { color: shelf.card, fontFamily: fonts.ui },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  barText: { fontFamily: fonts.ui, fontSize: 15 },
  barTitle: { flex: 1, textAlign: 'center', fontFamily: fonts.display, fontSize: 16 },
  meta: { fontFamily: fonts.ui, fontSize: 12, opacity: 0.8 },
  slider: { paddingVertical: 6 },
  sliderTrack: { height: 4, borderRadius: 99, overflow: 'hidden' },
  sliderFill: { height: 4, backgroundColor: shelf.accent },
  sheet: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  sheetScroll: { flex: 1 },
  sheetBody: { padding: 16, gap: 10 },
  sheetTitle: { fontFamily: fonts.display, fontSize: 22 },
  label: { fontFamily: fonts.ui, fontSize: 13 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: {
    borderWidth: 1,
    borderColor: '#c9bba8',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  chipOn: { borderColor: shelf.accent, backgroundColor: 'rgba(142,47,42,0.14)' },
  chipText: { fontFamily: fonts.ui, color: '#1E1A16' },
  note: { fontFamily: fonts.ui, color: '#6f6256', lineHeight: 20, fontSize: 13 },
  toc: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  tocItem: { fontFamily: fonts.display, fontSize: 20, paddingVertical: 8 },
});
