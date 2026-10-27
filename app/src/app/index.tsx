import { memo, useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import {
  continueReading,
  filterAndSortBooks,
  readingStatus,
  readingStatusLabel,
  shelfGrid,
  statusCounts,
  summarizeImports,
  type ImportAttempt,
  type ShelfFilter,
  type ShelfSort,
} from '../core/shelf';
import { useLibrary, type ShelfBook } from '../storage/library';
import { readAssetBytes } from '../reader/assets';
import { Frosted, LinenWash } from '../ui/glass';
import { shelfContentPadding } from '../ui/insets';
import { bundledSamples } from '../ui/samples';
import { clothColor, fonts, shelf } from '../ui/theme';

const SORTS: { id: ShelfSort; label: string }[] = [
  { id: 'recent', label: '最近加入' },
  { id: 'title', label: '书名' },
  { id: 'author', label: '作者' },
  { id: 'progress', label: '进度' },
  { id: 'opened', label: '最近读过' },
];

const FILTERS: { id: ShelfFilter; label: string }[] = [
  { id: 'reading', label: '在读' },
  { id: 'all', label: '全部' },
  { id: 'unread', label: '未读' },
  { id: 'finished', label: '读完' },
];

function CoverFace({ book, width, height, compact }: { book: ShelfBook; width: number; height: number; compact?: boolean }) {
  if (book.coverUri) {
    return <Image source={{ uri: book.coverUri }} style={{ width, height }} resizeMode="cover" fadeDuration={0} />;
  }
  return (
    <View style={[styles.cloth, { width, height, backgroundColor: clothColor(book.id) }]}>
      <View style={styles.spine} />
      <Text numberOfLines={compact ? 2 : 4} style={[styles.clothTitle, compact && styles.clothTitleCompact]}>
        {book.title}
      </Text>
    </View>
  );
}

function ProgressHairline({ progress }: { progress: number }) {
  if (progress <= 0.01) return null;
  return (
    <View style={styles.hairTrack} pointerEvents="none">
      <View style={[styles.hairFill, { width: `${Math.min(100, progress * 100)}%` }]} />
    </View>
  );
}

const BookCell = memo(function BookCell({
  book,
  width,
  height,
  menu,
  pending,
  onOpen,
  onRemove,
  onMark,
  onMenu,
}: {
  book: ShelfBook;
  width: number;
  height: number;
  menu: boolean;
  pending: boolean;
  onOpen: (id: string) => void;
  onRemove: (book: ShelfBook) => void;
  onMark: (book: ShelfBook) => void;
  onMenu: (id: string | null) => void;
}) {
  const status = readingStatus(book);
  return (
    <View style={{ width, marginBottom: 12 }}>
      <View style={[styles.cover, { width, height }]}>
        <CoverFace book={book} width={width} height={height} />
        <Text style={styles.badge}>{book.format.toUpperCase()}</Text>
        <ProgressHairline progress={book.progress} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${book.title}，${readingStatusLabel(status)}`}
          style={StyleSheet.absoluteFill}
          onPress={() => (menu ? onMenu(null) : onOpen(book.id))}
          onLongPress={() => onMenu(book.id)}
        />
        {menu ? (
          <View style={styles.coverMenu}>
            <Pressable onPress={() => onRemove(book)} hitSlop={6} style={styles.menuBtn}>
              <Text style={[styles.menuText, pending && styles.menuTextStrong]}>{pending ? '确认移出' : '移出'}</Text>
            </Pressable>
            <Pressable onPress={() => onMark(book)} hitSlop={6} style={styles.menuBtn}>
              <Text style={styles.menuText}>{status === 'finished' ? '标为在读' : '标为读完'}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={2} style={styles.bookTitle}>
        {book.title}
      </Text>
      {book.author ? (
        <Text numberOfLines={1} style={styles.bookAuthor}>
          {book.author}
        </Text>
      ) : null}
    </View>
  );
});

export default function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const library = useLibrary();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sort, setSort] = useState<ShelfSort>('recent');
  const [statusFilter, setStatusFilter] = useState<ShelfFilter>('all');
  const padding = shelfContentPadding(insets);
  const visibleBooks = useMemo(
    () => filterAndSortBooks(library.books, query, sort, statusFilter),
    [library.books, query, sort, statusFilter],
  );
  const counts = useMemo(() => statusCounts(library.books), [library.books]);
  const continueBook =
    library.ready && statusFilter === 'all' && !query.trim() ? continueReading(library.books) : null;
  const gridBooks = useMemo(
    () => (continueBook ? visibleBooks.filter((book) => book.id !== continueBook.id) : visibleBooks),
    [continueBook, visibleBooks],
  );
  const grid = shelfGrid(width, padding.paddingLeft, padding.paddingRight);
  const sortLabel = SORTS.find((item) => item.id === sort)?.label ?? '最近加入';

  const importPicked = async () => {
    setMessage(null);
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: true,
      type: ['application/pdf', 'application/epub+zip', 'application/octet-stream', '*/*'],
    });
    if (result.canceled) return;
    setBusy(true);
    const attempts: ImportAttempt[] = [];
    try {
      for (const asset of result.assets) {
        try {
          const bytes = await readPicked(asset);
          const imported = await library.importBytes(asset.name, bytes);
          attempts.push({ name: asset.name, ok: true, format: imported.format });
        } catch (error) {
          attempts.push({
            name: asset.name,
            ok: false,
            error: error instanceof Error ? error.message : '导入失败。',
          });
        }
      }
      setMessage(summarizeImports(attempts));
    } finally {
      setBusy(false);
    }
  };

  const importSamples = async () => {
    setBusy(true);
    setMessage(null);
    const attempts: ImportAttempt[] = [];
    try {
      for (const sample of bundledSamples) {
        try {
          const bytes = await readAssetBytes(sample.moduleId);
          const imported = await library.importBytes(sample.name, bytes);
          attempts.push({ name: sample.label, ok: true, format: imported.format });
        } catch (error) {
          attempts.push({
            name: sample.label,
            ok: false,
            error: error instanceof Error ? error.message : '示例导入失败。',
          });
        }
      }
      const summary = summarizeImports(attempts);
      setMessage(
        attempts.every((item) => item.ok)
          ? `四本示例已经放上书架，包含一本无 DRM 的 AZW3。它们都是仓库里的原创短篇，没有版权书。${summary}`
          : summary,
      );
    } finally {
      setBusy(false);
    }
  };

  const askRemove = useCallback((book: ShelfBook) => {
    if (pendingDelete === book.id) {
      setPendingDelete(null);
      setMenuId(null);
      void library.removeBook(book.id);
      setMessage(`已从书架拿走《${book.title}》。`);
      return;
    }
    setPendingDelete(book.id);
    setMenuId(book.id);
    setMessage(`再点一次「移出」，确认拿走《${book.title}》。文件会从这台设备上删除。`);
  }, [library, pendingDelete]);

  const openBook = useCallback(
    (id: string) => {
      setMenuId(null);
      router.push(`/read/${id}`);
    },
    [router],
  );

  const markBook = useCallback(
    (book: ShelfBook) => {
      const status = readingStatus(book);
      setMenuId(null);
      void library.markBook(book.id, status === 'finished' ? 'reading' : 'finished');
    },
    [library],
  );

  const setMenu = useCallback((id: string | null) => {
    setMenuId(id);
    if (id == null) setPendingDelete(null);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ShelfBook }) => (
      <BookCell
        book={item}
        width={grid.coverWidth}
        height={grid.coverHeight}
        menu={menuId === item.id}
        pending={pendingDelete === item.id}
        onOpen={openBook}
        onRemove={askRemove}
        onMark={markBook}
        onMenu={setMenu}
      />
    ),
    [askRemove, grid.coverHeight, grid.coverWidth, markBook, menuId, openBook, pendingDelete, setMenu],
  );

  const cycleSort = () => {
    const index = SORTS.findIndex((item) => item.id === sort);
    setSort(SORTS[(index + 1) % SORTS.length].id);
  };

  const header = (
    <View style={styles.headerBlock}>
      <Frosted tone="shelf" intensity={64} wash={0.34} radius={18} style={styles.headerCard}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>书架</Text>
          <Text style={styles.count}>
            {library.ready ? `${library.books.length} 本` : '…'}
            {library.ready && counts.reading > 0 ? ` · 在读 ${counts.reading}` : ''}
          </Text>
          <View style={styles.spacer} />
          <Pressable
            onPress={() => setSearchOpen((open) => !open)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="搜索"
          >
            <Text style={[styles.action, (searchOpen || query.trim()) && styles.actionOn]}>{searchOpen ? '收起' : '搜索'}</Text>
          </Pressable>
          <Pressable onPress={() => void importPicked()} disabled={busy} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.action, styles.actionStrong]}>导入</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/transfer')} hitSlop={8} accessibilityRole="button">
            <Text style={styles.action}>传书</Text>
          </Pressable>
          <Pressable onPress={() => void importSamples()} disabled={busy} hitSlop={8} accessibilityRole="button">
            <Text style={styles.action}>示例</Text>
          </Pressable>
        </View>
        {searchOpen || query.trim() ? (
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="书名、作者或文件名"
            placeholderTextColor={shelf.muted}
            style={styles.search}
            autoCorrect={false}
            clearButtonMode="while-editing"
            autoFocus={searchOpen && !query}
          />
        ) : null}
        <View style={styles.chips}>
          {FILTERS.map((choice) => {
            const on = statusFilter === choice.id;
            const count =
              choice.id === 'all'
                ? library.books.length
                : choice.id === 'reading'
                  ? counts.reading
                  : choice.id === 'unread'
                    ? counts.unread
                    : counts.finished;
            return (
              <Pressable
                key={choice.id}
                onPress={() => setStatusFilter(choice.id)}
                style={[styles.chip, on && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                  {choice.label}
                  {library.ready && library.books.length > 0 ? ` ${count}` : ''}
                </Text>
              </Pressable>
            );
          })}
          <Pressable onPress={cycleSort} style={styles.chip} accessibilityRole="button" accessibilityLabel={`排序，${sortLabel}`}>
            <Text style={styles.chipText}>{sortLabel}</Text>
          </Pressable>
        </View>
        {busy ? <ActivityIndicator color={shelf.accent} style={styles.busy} /> : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {library.error ? <Text style={styles.message}>{library.error}</Text> : null}
      </Frosted>
      {continueBook ? (
        <View style={styles.continueWrap}>
          <Pressable
            style={styles.continue}
            onPress={() => openBook(continueBook.id)}
            onLongPress={() => setMenu(continueBook.id)}
            accessibilityRole="button"
            accessibilityLabel={`继续阅读 ${continueBook.title}`}
          >
            <View style={styles.continueCover}>
              <CoverFace book={continueBook} width={44} height={66} compact />
              <ProgressHairline progress={continueBook.progress} />
            </View>
            <View style={styles.continueBody}>
              <Text style={styles.kicker}>继续阅读</Text>
              <Text numberOfLines={1} style={styles.continueTitle}>
                {continueBook.title}
              </Text>
              {continueBook.author ? (
                <Text numberOfLines={1} style={styles.bookAuthor}>
                  {continueBook.author}
                </Text>
              ) : null}
            </View>
            {continueBook.progress > 0.01 ? (
              <Text style={styles.percent}>{Math.round(continueBook.progress * 100)}%</Text>
            ) : null}
          </Pressable>
          {menuId === continueBook.id ? (
            <View style={styles.inlineMenu}>
              <Pressable onPress={() => askRemove(continueBook)} hitSlop={6}>
                <Text style={[styles.menuTextDark, pendingDelete === continueBook.id && styles.menuTextStrong]}>
                  {pendingDelete === continueBook.id ? '确认移出' : '移出'}
                </Text>
              </Pressable>
              <Pressable onPress={() => markBook(continueBook)} hitSlop={6}>
                <Text style={styles.menuTextDark}>
                  {readingStatus(continueBook) === 'finished' ? '标为在读' : '标为读完'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const empty = !library.ready && !library.error ? (
    <View style={styles.emptyPlain}>
      <ActivityIndicator color={shelf.accent} />
      <Text style={styles.emptyBody}>正在打开书架…</Text>
    </View>
  ) : library.ready && library.books.length === 0 ? (
    <View style={styles.emptyPlain}>
      <Text style={styles.emptyTitle}>还没有书</Text>
      <Text style={styles.emptyBody}>
        点上方「导入」或「示例」。装到 iPhone 之后，用 Windows 的 BookPush 经家里的 Wi-Fi 把书送进来。
      </Text>
    </View>
  ) : library.ready && gridBooks.length === 0 && !continueBook ? (
    <View style={styles.emptyPlain}>
      <Text style={styles.emptyTitle}>
        {query.trim() ? '没有符合的书' : statusFilter === 'all' ? '没有符合的书' : `没有${FILTERS.find((item) => item.id === statusFilter)?.label ?? ''}的书`}
      </Text>
      <Text style={styles.emptyBody}>换一个词，或切回「全部」。架子上的书还在。</Text>
    </View>
  ) : undefined;

  return (
    <View style={styles.screen}>
      <LinenWash />
      <FlatList
        style={styles.list}
        data={library.ready ? gridBooks : []}
        key={grid.columns}
        keyExtractor={(book) => book.id}
        numColumns={grid.columns}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        columnWrapperStyle={grid.columns > 1 ? { gap: grid.gap } : undefined}
        contentContainerStyle={padding}
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={Platform.OS === 'ios'}
        initialNumToRender={12}
        maxToRenderPerBatch={9}
        windowSize={7}
        updateCellsBatchingPeriod={50}
        extraData={`${pendingDelete}:${menuId}`}
      />
      {insets.top > 0 ? <Frosted tone="shelf" intensity={80} wash={0.48} style={[styles.edgeGlass, { top: 0, height: insets.top }]} /> : null}
      {insets.bottom > 0 ? (
        <Frosted tone="shelf" intensity={72} wash={0.42} style={[styles.edgeGlass, { bottom: 0, height: insets.bottom }]} />
      ) : null}
    </View>
  );
}

async function readPicked(asset: DocumentPicker.DocumentPickerAsset): Promise<Uint8Array> {
  const file = asset.file as { arrayBuffer?: () => Promise<ArrayBuffer> } | undefined;
  if (file && typeof file.arrayBuffer === 'function') {
    return new Uint8Array(await file.arrayBuffer());
  }
  if (asset.base64) {
    const binary = atob(asset.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  const { File } = await import('expo-file-system');
  return new File(asset.uri).bytes();
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: shelf.bg },
  list: { flex: 1, backgroundColor: 'transparent' },
  edgeGlass: { position: 'absolute', left: 0, right: 0 },
  headerBlock: { marginBottom: 8 },
  headerCard: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10 },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  spacer: { flex: 1 },
  title: { color: shelf.ink, fontFamily: fonts.ui, fontSize: 22, lineHeight: 28, fontWeight: '700' },
  count: { color: shelf.muted, fontFamily: fonts.ui, fontSize: 13 },
  action: { color: shelf.ink, fontFamily: fonts.ui, fontSize: 15, fontWeight: '500' },
  actionStrong: { color: shelf.accent, fontWeight: '700' },
  actionOn: { color: shelf.accent },
  search: {
    marginTop: 8,
    backgroundColor: 'rgba(255,252,247,0.72)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: fonts.ui,
    fontSize: 15,
    color: shelf.ink,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60,40,20,0.14)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,252,247,0.45)',
  },
  chipOn: { borderColor: shelf.accent, backgroundColor: 'rgba(142,59,52,0.12)' },
  chipText: { fontFamily: fonts.ui, color: shelf.ink, fontSize: 12 },
  chipTextOn: { color: shelf.accent, fontWeight: '600' },
  busy: { marginTop: 8 },
  message: { color: shelf.ink, fontFamily: fonts.ui, marginTop: 8, lineHeight: 20, fontSize: 13 },
  continueWrap: { marginTop: 8 },
  continue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  continueCover: {
    width: 44,
    height: 66,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: shelf.cardSolid,
  },
  continueBody: { flex: 1, gap: 1 },
  kicker: { color: shelf.accent, fontFamily: fonts.ui, fontSize: 11, fontWeight: '600', letterSpacing: 0.4 },
  continueTitle: { color: shelf.ink, fontFamily: fonts.ui, fontSize: 16, fontWeight: '600' },
  percent: { color: shelf.muted, fontFamily: fonts.ui, fontSize: 12 },
  inlineMenu: { flexDirection: 'row', gap: 16, paddingLeft: 54, paddingBottom: 4 },
  emptyPlain: { paddingVertical: 12, paddingHorizontal: 4, gap: 6 },
  emptyTitle: { fontFamily: fonts.ui, fontSize: 20, fontWeight: '700', color: shelf.ink },
  emptyBody: { fontFamily: fonts.ui, color: shelf.muted, lineHeight: 21, fontSize: 14 },
  bookTitle: { marginTop: 6, color: shelf.ink, fontFamily: fonts.ui, fontSize: 13, lineHeight: 17, fontWeight: '600' },
  bookAuthor: { color: shelf.muted, fontFamily: fonts.ui, fontSize: 11, lineHeight: 14, marginTop: 1 },
  menuTextDark: { color: shelf.accent, fontFamily: fonts.ui, fontSize: 13 },
  menuTextStrong: { fontWeight: '700' },
  cover: {
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: shelf.cardSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(42,28,18,0.16)',
    shadowColor: '#2a1c12',
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cloth: { padding: 8, justifyContent: 'flex-end' },
  spine: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, backgroundColor: 'rgba(0,0,0,0.22)' },
  clothTitle: { color: '#F6EFE4', fontFamily: fonts.display, fontSize: 15, lineHeight: 20 },
  clothTitleCompact: { fontSize: 11, lineHeight: 14 },
  badge: {
    position: 'absolute',
    top: 5,
    right: 5,
    backgroundColor: 'rgba(255,250,243,0.88)',
    color: shelf.ink,
    overflow: 'hidden',
    borderRadius: 999,
    fontSize: 9,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontFamily: fonts.ui,
    fontWeight: '600',
  },
  hairTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(28,25,22,0.28)',
  },
  hairFill: { height: 3, backgroundColor: shelf.accent },
  coverMenu: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(28,25,22,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    zIndex: 2,
  },
  menuBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  menuText: { color: '#F8F1E8', fontFamily: fonts.ui, fontSize: 13 },
});
