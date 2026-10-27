import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { readingStatus, readingStatusLabel } from '../../core/shelf';
import { normalizeReaderSettings } from '../../core/settings';
import { BookError, type LoadedBook, type PageTurnMode, type ReaderAlign, type ReaderFontId, type ReaderSettings, type ReaderTheme } from '../../core/types';
import { ReaderPane, type ReaderProgress } from '../../reader/ReaderPane';
import { useLibrary } from '../../storage/library';
import { Frosted } from '../../ui/glass';
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

const TURN_CHOICES: { id: PageTurnMode; label: string }[] = [
  { id: 'curl', label: '卷页' },
  { id: 'slide', label: '滑动' },
  { id: 'none', label: '无' },
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
  const hairline = settings.theme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(60,40,20,0.12)';
  const choiceText = [styles.chipText, { color: colors.ink }];
  const choiceFace = [styles.chip, settings.theme === 'dark' && styles.chipDark];
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
            opacity: chromeOpacity,
            transform: [{ translateY: chromeOpacity.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
          },
        ]}
      >
        <Frosted tone={settings.theme} intensity={42} wash={0.18} style={styles.barBlur}>
          <View
            style={[
              styles.topRow,
              {
                paddingTop: topChromePadding(insets),
                paddingLeft: Math.max(insets.left, 16),
                paddingRight: Math.max(insets.right, 16),
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
          </View>
          <View style={[styles.hairline, { backgroundColor: hairline }]} />
        </Frosted>
      </Animated.View>
      <Animated.View
        pointerEvents={showChrome ? 'auto' : 'none'}
        style={[
          styles.bottomBar,
          {
            opacity: chromeOpacity,
            transform: [{ translateY: chromeOpacity.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
          },
        ]}
      >
        <Frosted tone={settings.theme} intensity={46} wash={0.2} style={styles.barBlur}>
          <View style={[styles.hairline, { backgroundColor: hairline }]} />
          <View
            style={[
              styles.bottomInner,
              {
                paddingBottom: bottomChromePadding(insets),
                paddingLeft: Math.max(insets.left, 16),
                paddingRight: Math.max(insets.right, 16),
              },
            ]}
          >
            <Text style={[styles.meta, { color: colors.muted }]} numberOfLines={1}>
              {progress
                ? `${readingStatusLabel(status)} · ${progress.chapterTitle || '正文'} · ${progress.pageIndex + 1}/${Math.max(progress.pageCount, 1)}`
                : '点右侧或滑动翻页，点页面中间收起菜单'}
            </Text>
            <View style={styles.bottomControls}>
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
              <Pressable onPress={() => void library.markBook(bookId, finished ? 'reading' : 'finished')} hitSlop={6}>
                <Text style={[styles.barText, { color: colors.ink }]}>{finished ? '在读' : '读完'}</Text>
              </Pressable>
              <Pressable onPress={() => setPanel(panel === 'settings' ? 'none' : 'settings')} hitSlop={6}>
                <Text style={[styles.aa, { color: colors.ink }]}>Aa</Text>
              </Pressable>
            </View>
          </View>
        </Frosted>
      </Animated.View>
      {panel === 'settings' ? (
        <Frosted
          tone={settings.theme}
          intensity={82}
          wash={0.46}
          radius={28}
          style={[styles.sheet, { left: Math.max(insets.left, 12), right: Math.max(insets.right, 12), bottom: Math.max(insets.bottom, 8), height: sheetHeight }]}
        >
          <View style={styles.grabberWrap}>
            <View style={[styles.grabber, { backgroundColor: colors.muted }]} />
          </View>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            <View style={styles.sheetHead}>
              <Text style={[styles.sheetTitle, { color: colors.ink }]}>排版</Text>
              <Pressable onPress={() => setPanel('none')} hitSlop={8}>
                <Text style={[styles.barText, { color: colors.ink }]}>完成</Text>
              </Pressable>
            </View>
            <View style={styles.row}>
              <Pressable onPress={() => void library.clearBookSettings(bookId)} style={[...choiceFace, !scopedToBook && styles.chipOn]}>
                <Text style={choiceText}>全部书籍</Text>
              </Pressable>
              <Pressable onPress={() => void library.updateSettings(settings, bookId)} style={[...choiceFace, scopedToBook && styles.chipOn]}>
                <Text style={choiceText}>仅本书</Text>
              </Pressable>
            </View>
            <Text style={[styles.note, { color: colors.muted }]}>
              {scopedToBook ? '现在的字号、字体、行距和竖排只留给这本书。' : '改动会用到书架上还没有单独排版的书。'}
            </Text>
            <Text style={[styles.label, { color: colors.ink }]}>字体</Text>
            <View style={styles.row}>
              {FONT_CHOICES.map((choice) => (
                <Pressable key={choice.id} onPress={() => patch({ fontId: choice.id })} style={[...choiceFace, settings.fontId === choice.id && styles.chipOn]}>
                  <Text style={choiceText}>{choice.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.label, { color: colors.ink }]}>字号</Text>
            <View style={styles.row}>
              <Pressable onPress={() => patch({ fontSize: settings.fontSize - 1 })} style={choiceFace}>
                <Text style={choiceText}>A-</Text>
              </Pressable>
              <Text style={{ color: colors.ink, fontFamily: fonts.ui }}>{settings.fontSize}</Text>
              <Pressable onPress={() => patch({ fontSize: settings.fontSize + 1 })} style={choiceFace}>
                <Text style={choiceText}>A+</Text>
              </Pressable>
            </View>
            <Text style={[styles.label, { color: colors.ink }]}>行距</Text>
            <View style={styles.row}>
              <Pressable onPress={() => patch({ lineHeight: Math.round(settings.lineHeight * 100 - 10) / 100 })} style={choiceFace}>
                <Text style={choiceText}>更紧</Text>
              </Pressable>
              <Text style={{ color: colors.ink, fontFamily: fonts.ui }}>{settings.lineHeight.toFixed(2)}</Text>
              <Pressable onPress={() => patch({ lineHeight: Math.round(settings.lineHeight * 100 + 10) / 100 })} style={choiceFace}>
                <Text style={choiceText}>更松</Text>
              </Pressable>
            </View>
            <Text style={[styles.label, { color: colors.ink }]}>边距</Text>
            <View style={styles.row}>
              {MARGIN_CHOICES.map((choice) => (
                <Pressable key={choice.value} onPress={() => patch({ margin: choice.value })} style={[...choiceFace, settings.margin === choice.value && styles.chipOn]}>
                  <Text style={choiceText}>{choice.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.label, { color: colors.ink }]}>对齐</Text>
            <View style={styles.row}>
              {ALIGN_CHOICES.map((choice) => (
                <Pressable key={choice.id} onPress={() => patch({ align: choice.id })} style={[...choiceFace, settings.align === choice.id && styles.chipOn]}>
                  <Text style={choiceText}>{choice.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.label, { color: colors.ink }]}>翻页</Text>
            <View style={styles.row}>
              {TURN_CHOICES.map((choice) => (
                <Pressable key={choice.id} onPress={() => patch({ pageTurn: choice.id })} style={[...choiceFace, settings.pageTurn === choice.id && styles.chipOn]}>
                  <Text style={choiceText}>{choice.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.note, { color: colors.muted }]}>
              卷页的背面是同一张纸的颜色，折痕连着下一页，不会闪出一块白纸。连续点右侧会尽快翻过去。滑动是短横滑，无则立刻换页。系统开了「减少动态效果」时改为短淡入。
            </Text>
            <Text style={[styles.label, { color: colors.ink }]}>纸色</Text>
            <View style={styles.row}>
              {THEME_CHOICES.map((choice) => (
                <Pressable key={choice.id} onPress={() => patch({ theme: choice.id })} style={[...choiceFace, settings.theme === choice.id && styles.chipOn]}>
                  <Text style={choiceText}>{choice.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.row}>
              <Pressable style={[...choiceFace, settings.vertical && styles.chipOn]} onPress={() => patch({ vertical: !settings.vertical })}>
                <Text style={choiceText}>竖排 {settings.vertical ? '开' : '关'}</Text>
              </Pressable>
              <Pressable style={[...choiceFace, settings.traditional && styles.chipOn]} onPress={() => patch({ traditional: !settings.traditional })}>
                <Text style={choiceText}>简转繁 {settings.traditional ? '开' : '关'}</Text>
              </Pressable>
            </View>
            <Text style={[styles.note, { color: colors.muted }]}>
              {loaded.format === 'pdf'
                ? 'PDF 保持原页面。字号、字体、行距、边距、对齐、竖排和简转繁对它不起作用。纸色和亮度仍然有效。'
                : '中文正文首行缩进两个字，段距收紧，接近 Apple Books。竖排使用 writing-mode: vertical-rl。简转繁来自 OpenCC 字词表，原文件不改，个别多义字可能不是你要的那个。'}
            </Text>
            <Text style={[styles.note, { color: colors.ink }]}>纸面亮度 {Math.round(settings.brightness * 100)}%</Text>
            <View style={styles.row}>
              <Pressable onPress={() => patch({ brightness: Math.round((settings.brightness - 0.05) * 100) / 100 })} style={choiceFace}>
                <Text style={choiceText}>暗</Text>
              </Pressable>
              <Pressable onPress={() => patch({ brightness: Math.round((settings.brightness + 0.05) * 100) / 100 })} style={choiceFace}>
                <Text style={choiceText}>亮</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Frosted>
      ) : null}
      {panel === 'toc' ? (
        <Frosted tone={settings.theme} intensity={88} wash={0.58} style={styles.toc}>
          <View
            style={[
              styles.tocHead,
              {
                paddingTop: insets.top + 8,
                paddingLeft: Math.max(insets.left, 18),
                paddingRight: Math.max(insets.right, 18),
              },
            ]}
          >
            <Text style={[styles.sheetTitle, { color: colors.ink }]}>目录</Text>
            <Pressable onPress={() => setPanel('none')} hitSlop={8}>
              <Text style={[styles.barText, { color: colors.ink }]}>完成</Text>
            </Pressable>
          </View>
          <ScrollView
            contentInsetAdjustmentBehavior="never"
            contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 24, gap: 8 }}
          >
            <Text style={[styles.sheetTitle, { color: colors.ink }]}>书签</Text>
            {(library.bookmarks[bookId] ?? []).length === 0 ? (
              <Text style={[styles.note, { color: colors.muted }]}>还没有书签。阅读时点上方「书签」记住这一页。</Text>
            ) : null}
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
            {loaded.format === 'pdf' ? <Text style={[styles.note, { color: colors.muted }]}>这本 PDF 没有目录，用底部进度条翻页。</Text> : null}
          </ScrollView>
        </Frosted>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorTitle: { fontFamily: fonts.display, fontSize: 32, color: shelf.ink, marginBottom: 8 },
  errorBody: { fontFamily: fonts.ui, color: shelf.muted, lineHeight: 22, textAlign: 'center' },
  backButton: { marginTop: 18, backgroundColor: shelf.ink, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 10 },
  backButtonText: { color: shelf.accentInk, fontFamily: fonts.ui },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3 },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3 },
  barBlur: { overflow: 'hidden' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 8, minHeight: 36 },
  bottomInner: { paddingTop: 8, gap: 4 },
  bottomControls: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  hairline: { height: StyleSheet.hairlineWidth },
  barText: { fontFamily: fonts.ui, fontSize: 15, fontWeight: '500' },
  aa: { fontFamily: fonts.display, fontSize: 18, fontWeight: '600' },
  barTitle: { flex: 1, textAlign: 'center', fontFamily: fonts.ui, fontSize: 16, fontWeight: '600' },
  meta: { fontFamily: fonts.ui, fontSize: 12 },
  slider: { flex: 1, paddingVertical: 8 },
  sliderTrack: { height: 3, borderRadius: 99, overflow: 'hidden' },
  sliderFill: { height: 3, backgroundColor: shelf.accent },
  sheet: {
    position: 'absolute',
    zIndex: 4,
    shadowColor: '#1c140e',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  grabberWrap: { alignItems: 'center', paddingTop: 8 },
  grabber: { width: 36, height: 5, borderRadius: 3, opacity: 0.45 },
  sheetScroll: { flex: 1 },
  sheetBody: { paddingHorizontal: 16, paddingBottom: 20, gap: 10 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontFamily: fonts.ui, fontSize: 22, fontWeight: '700' },
  label: { fontFamily: fonts.ui, fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(80,50,30,0.18)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,252,247,0.55)',
  },
  chipDark: { borderColor: 'rgba(255,255,255,0.16)', backgroundColor: 'rgba(255,255,255,0.08)' },
  chipOn: { borderColor: shelf.accent, backgroundColor: 'rgba(142,59,52,0.16)' },
  chipText: { fontFamily: fonts.ui, fontSize: 14 },
  note: { fontFamily: fonts.ui, lineHeight: 20, fontSize: 13 },
  toc: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 },
  tocHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 4 },
  tocItem: { fontFamily: fonts.display, fontSize: 20, lineHeight: 28, paddingVertical: 8 },
});
