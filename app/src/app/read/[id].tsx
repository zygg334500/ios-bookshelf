import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookError, type LoadedBook, type ReaderFontId, type ReaderTheme } from '../../core/types';
import { ReaderPane, type ReaderProgress } from '../../reader/ReaderPane';
import { useLibrary } from '../../storage/library';
import { fonts, shelf } from '../../ui/theme';

const FONT_CHOICES: { id: ReaderFontId; label: string }[] = [
  { id: 'system', label: '系统' },
  { id: 'pingfang', label: '苹方' },
  { id: 'songti', label: '宋体' },
  { id: 'kaiti', label: '楷体' },
];

const THEME_CHOICES: { id: ReaderTheme; label: string }[] = [
  { id: 'light', label: '白' },
  { id: 'sepia', label: '羊皮纸' },
  { id: 'dark', label: '夜' },
];

export default function ReadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookId = String(id ?? '');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const library = useLibrary();
  const record = library.books.find((book) => book.id === bookId);
  const [loaded, setLoaded] = useState<LoadedBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState<'none' | 'settings' | 'toc'>('none');
  const [progress, setProgress] = useState<ReaderProgress | null>(null);
  const [seek, setSeek] = useState<{ nonce: number; progress: number | null }>({ nonce: 0, progress: null });
  const [barWidth, setBarWidth] = useState(1);

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

  const themePaper = library.settings.theme === 'dark' ? '#1c1a17' : library.settings.theme === 'light' ? '#fbfbf8' : '#f4ecd8';
  const themeInk = library.settings.theme === 'dark' ? '#ece4d6' : '#241c16';
  const dim = 1 - library.settings.brightness;

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: shelf.bg, padding: 24 }]}>
        <Text style={styles.errorTitle}>{error.includes('DRM') ? '有 DRM 的书' : '打不开'}</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>返回书架</Text>
        </Pressable>
      </View>
    );
  }

  if (!loaded || !record) {
    return (
      <View style={[styles.center, { backgroundColor: themePaper }]}>
        <ActivityIndicator color={shelf.accent} />
        <Text style={{ marginTop: 12, color: themeInk, fontFamily: fonts.ui }}>正在排版…</Text>
      </View>
    );
  }

  const topInset = chrome ? insets.top + 48 : 0;
  const bottomInset = panel === 'settings' ? insets.bottom + 300 : chrome ? insets.bottom + 108 : 0;

  return (
    <View style={{ flex: 1, backgroundColor: themePaper }}>
      <View style={{ flex: 1, marginTop: topInset, marginBottom: bottomInset }}>
        <ReaderPane
          book={loaded}
          settings={library.settings}
          initialChapter={record.chapterIndex}
          initialPage={record.pageIndex}
          seekNonce={seek.nonce}
          seekProgress={seek.progress}
          onProgress={setProgress}
          onChrome={() => {
            setChrome((value) => !value);
            setPanel('none');
          }}
          onCover={(dataUrl) => void library.saveCover(bookId, dataUrl)}
          onError={setError}
        />
      </View>
      {dim > 0.01 ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${dim})` }]} /> : null}
      {chrome ? (
        <View style={[styles.topBar, { paddingTop: insets.top + 8, backgroundColor: themePaper }]}>
          <Pressable onPress={() => router.back()}>
            <Text style={[styles.barText, { color: themeInk }]}>书架</Text>
          </Pressable>
          <Text numberOfLines={1} style={[styles.barTitle, { color: themeInk }]}>
            {loaded.title}
          </Text>
          <Pressable onPress={() => setPanel(panel === 'toc' ? 'none' : 'toc')}>
            <Text style={[styles.barText, { color: themeInk }]}>目录</Text>
          </Pressable>
        </View>
      ) : null}
      {chrome ? (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 10, backgroundColor: themePaper }]}>
          <Text style={[styles.meta, { color: themeInk }]}>
            {progress
              ? `${progress.chapterTitle || '正文'} · ${progress.pageIndex + 1}/${Math.max(progress.pageCount, 1)}`
              : '点左右两侧翻页，点中间收起菜单'}
          </Text>
          <Pressable
            style={styles.slider}
            onLayout={(event) => setBarWidth(event.nativeEvent.layout.width || 1)}
            onPress={(event) => {
              const ratio = Math.min(0.999, Math.max(0, event.nativeEvent.locationX / barWidth));
              setSeek({ nonce: Date.now(), progress: ratio });
            }}
          >
            <View style={[styles.sliderTrack, { backgroundColor: themeInk === '#ece4d6' ? '#3a342c' : '#ddd4c6' }]}>
              <View style={[styles.sliderFill, { width: `${Math.round((progress?.progress ?? record.progress) * 100)}%` }]} />
            </View>
          </Pressable>
          <Pressable onPress={() => setPanel(panel === 'settings' ? 'none' : 'settings')}>
            <Text style={[styles.barText, { color: themeInk }]}>Aa 设置</Text>
          </Pressable>
        </View>
      ) : null}
      {panel === 'settings' ? (
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16, backgroundColor: themePaper }]}>
          <Text style={[styles.sheetTitle, { color: themeInk }]}>阅读</Text>
          <View style={styles.row}>
            {FONT_CHOICES.map((choice) => (
              <Pressable
                key={choice.id}
                onPress={() => void library.updateSettings({ ...library.settings, fontId: choice.id })}
                style={[styles.chip, library.settings.fontId === choice.id && styles.chipOn]}
              >
                <Text style={styles.chipText}>{choice.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <Pressable onPress={() => void library.updateSettings({ ...library.settings, fontSize: Math.max(15, library.settings.fontSize - 1) })} style={styles.chip}>
              <Text style={styles.chipText}>A-</Text>
            </Pressable>
            <Text style={{ color: themeInk, fontFamily: fonts.ui }}>{library.settings.fontSize}</Text>
            <Pressable onPress={() => void library.updateSettings({ ...library.settings, fontSize: Math.min(32, library.settings.fontSize + 1) })} style={styles.chip}>
              <Text style={styles.chipText}>A+</Text>
            </Pressable>
          </View>
          <View style={styles.row}>
            {THEME_CHOICES.map((choice) => (
              <Pressable
                key={choice.id}
                onPress={() => void library.updateSettings({ ...library.settings, theme: choice.id })}
                style={[styles.chip, library.settings.theme === choice.id && styles.chipOn]}
              >
                <Text style={styles.chipText}>{choice.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            style={[styles.chip, library.settings.verticalTraditional && styles.chipOn, { alignSelf: 'flex-start' }]}
            onPress={() =>
              void library.updateSettings({
                ...library.settings,
                verticalTraditional: !library.settings.verticalTraditional,
              })
            }
          >
            <Text style={styles.chipText}>竖排繁体 {library.settings.verticalTraditional ? '开' : '关'}</Text>
          </Pressable>
          <Text style={styles.note}>
            {loaded.format === 'pdf'
              ? 'PDF 保持原页面，不重排，也不做简转繁。'
              : '竖排使用 writing-mode: vertical-rl，并把简体显示成繁体。转换来自 OpenCC 字词表，个别多音字可能不是你要的那个字。'}
          </Text>
          <Text style={[styles.note, { color: themeInk }]}>纸面亮度 {Math.round(library.settings.brightness * 100)}%</Text>
          <View style={styles.row}>
            <Pressable onPress={() => void library.updateSettings({ ...library.settings, brightness: Math.max(0.55, library.settings.brightness - 0.05) })} style={styles.chip}>
              <Text style={styles.chipText}>暗</Text>
            </Pressable>
            <Pressable onPress={() => void library.updateSettings({ ...library.settings, brightness: Math.min(1, library.settings.brightness + 0.05) })} style={styles.chip}>
              <Text style={styles.chipText}>亮</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {panel === 'toc' ? (
        <View style={[styles.toc, { paddingTop: insets.top + 64, backgroundColor: themePaper }]}>
          <ScrollView contentContainerStyle={{ padding: 18, gap: 8 }}>
            {(loaded.toc.length ? loaded.toc : loaded.chapters.map((chapter, chapterIndex) => ({ title: chapter.title, chapterIndex }))).map((item, index) => (
              <Pressable
                key={`${item.chapterIndex}-${index}`}
                onPress={() => {
                  const count = Math.max(loaded.chapters.length, 1);
                  setSeek({ nonce: Date.now(), progress: item.chapterIndex / count });
                  setPanel('none');
                }}
              >
                <Text style={[styles.tocItem, { color: themeInk }]}>{item.title}</Text>
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
    paddingBottom: 10,
  },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  barText: { fontFamily: fonts.ui, fontSize: 15 },
  barTitle: { flex: 1, textAlign: 'center', fontFamily: fonts.display, fontSize: 16 },
  meta: { fontFamily: fonts.ui, fontSize: 12, opacity: 0.8 },
  slider: { paddingVertical: 8 },
  sliderTrack: { height: 4, borderRadius: 99, overflow: 'hidden' },
  sliderFill: { height: 4, backgroundColor: shelf.accent },
  sheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 18,
    padding: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
  },
  sheetTitle: { fontFamily: fonts.display, fontSize: 22 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: { borderWidth: 1, borderColor: '#c9bba8', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.35)' },
  chipOn: { borderColor: shelf.accent, backgroundColor: 'rgba(142,47,42,0.14)' },
  chipText: { fontFamily: fonts.ui, color: '#1E1A16' },
  note: { fontFamily: fonts.ui, color: '#6f6256', lineHeight: 20, fontSize: 13 },
  toc: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  tocItem: { fontFamily: fonts.display, fontSize: 20, paddingVertical: 8 },
});
