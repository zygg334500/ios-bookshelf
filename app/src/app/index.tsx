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
  filterAndSortBooks,
  readingStatus,
  readingStatusLabel,
  shelfCountLabel,
  statusCounts,
  statusSummary,
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

const BookCell = memo(function BookCell({
  book,
  width,
  pending,
  onOpen,
  onRemove,
  onMark,
}: {
  book: ShelfBook;
  width: number;
  pending: boolean;
  onOpen: (id: string) => void;
  onRemove: (book: ShelfBook) => void;
  onMark: (book: ShelfBook) => void;
}) {
  const height = Math.round(width * 1.48);
  const status = readingStatus(book);
  return (
    <View style={{ width, marginBottom: 16 }}>
      <Pressable onPress={() => onOpen(book.id)} onLongPress={() => onRemove(book)}>
        {book.coverUri ? (
          <View style={[styles.cover, { width, height }]}>
            <Image source={{ uri: book.coverUri }} style={{ width, height }} resizeMode="cover" fadeDuration={0} />
            <Text style={styles.badge}>{book.format.toUpperCase()}</Text>
          </View>
        ) : (
          <View style={[styles.cover, styles.cloth, { width, height, backgroundColor: clothColor(book.id) }]}>
            <View style={styles.spine} />
            <Text numberOfLines={4} style={styles.clothTitle}>
              {book.title}
            </Text>
            <Text style={styles.badgeLight}>{book.format.toUpperCase()}</Text>
          </View>
        )}
        <Text numberOfLines={2} style={styles.bookTitle}>
          {book.title}
        </Text>
        <Text numberOfLines={1} style={styles.bookAuthor}>
          {book.author}
        </Text>
        <Text
          style={[
            styles.status,
            status === 'reading' && styles.statusReading,
            status === 'finished' && styles.statusDone,
          ]}
        >
          {readingStatusLabel(status)}
        </Text>
      </Pressable>
      {book.progress > 0.01 ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.min(100, book.progress * 100)}%` }]} />
        </View>
      ) : null}
      <View style={styles.cardActions}>
        <Pressable onPress={() => onRemove(book)} hitSlop={6}>
          <Text style={[styles.remove, pending && styles.removeArmed]}>{pending ? '确认移出' : '移出'}</Text>
        </Pressable>
        <Pressable onPress={() => onMark(book)} hitSlop={6}>
          <Text style={styles.remove}>{status === 'finished' ? '标为在读' : '标为读完'}</Text>
        </Pressable>
      </View>
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
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ShelfSort>('recent');
  const [statusFilter, setStatusFilter] = useState<ShelfFilter>('all');
  const padding = shelfContentPadding(insets);
  const visibleBooks = useMemo(
    () => filterAndSortBooks(library.books, query, sort, statusFilter),
    [library.books, query, sort, statusFilter],
  );
  const counts = useMemo(() => statusCounts(library.books), [library.books]);
  const sortChoices: { id: ShelfSort; label: string }[] = [
    { id: 'recent', label: '最近加入' },
    { id: 'title', label: '书名' },
    { id: 'author', label: '作者' },
    { id: 'progress', label: '进度' },
    { id: 'opened', label: '最近读过' },
  ];
  const filterChoices: { id: ShelfFilter; label: string }[] = [
    { id: 'all', label: '全部' },
    { id: 'unread', label: '未读' },
    { id: 'reading', label: '阅读中' },
    { id: 'finished', label: '已完成' },
  ];
  const columns = width >= 1100 ? 6 : width >= 840 ? 5 : width >= 640 ? 4 : 3;
  const gap = 12;
  const itemWidth = Math.floor((width - padding.paddingLeft - padding.paddingRight - gap * (columns - 1)) / columns);

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
      void library.removeBook(book.id);
      setMessage(`已从书架拿走《${book.title}》。`);
      return;
    }
    setPendingDelete(book.id);
    setMessage(`再点一次「移出」，确认拿走《${book.title}》。文件会从这台设备上删除。`);
  }, [library, pendingDelete]);

  const openBook = useCallback(
    (id: string) => {
      router.push(`/read/${id}`);
    },
    [router],
  );

  const markBook = useCallback(
    (book: ShelfBook) => {
      const status = readingStatus(book);
      void library.markBook(book.id, status === 'finished' ? 'reading' : 'finished');
    },
    [library],
  );

  const renderItem = useCallback(
    ({ item }: { item: ShelfBook }) => (
      <BookCell
        book={item}
        width={itemWidth}
        pending={pendingDelete === item.id}
        onOpen={openBook}
        onRemove={askRemove}
        onMark={markBook}
      />
    ),
    [askRemove, itemWidth, markBook, openBook, pendingDelete],
  );

  const header = (
    <View style={styles.headerShadow}>
      <Frosted tone="shelf" intensity={68} wash={0.4} radius={28} style={styles.headerCard}>
      <View style={styles.header}>
        <View style={styles.seal}>
          <Text style={styles.sealText}>书</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>BOOKSHELF</Text>
          <Text style={styles.title}>书架</Text>
          <Text style={styles.sub}>离线阅读。PDF、EPUB，以及没有 DRM 的 AZW3。</Text>
          <Text style={styles.sub}>
            {library.ready
              ? library.books.length === 0
                ? shelfCountLabel(0)
                : query.trim() || statusFilter !== 'all'
                  ? `架上 ${library.books.length} 本，符合 ${visibleBooks.length} 本。`
                  : `架上 ${library.books.length} 本。点封面打开。`
              : '正在打开书架…'}
          </Text>
          {library.ready && library.books.length > 0 ? <Text style={styles.sub}>{statusSummary(counts)}</Text> : null}
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable style={styles.primary} onPress={() => void importPicked()} disabled={busy}>
          <Text style={styles.primaryText}>导入</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={() => router.push('/transfer')}>
          <Text style={styles.secondaryText}>Wi-Fi 传书</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={() => void importSamples()} disabled={busy}>
          <Text style={styles.secondaryText}>放入示例</Text>
        </Pressable>
      </View>
      {busy ? <ActivityIndicator color={shelf.accent} style={{ marginVertical: 12 }} /> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {library.error ? <Text style={styles.message}>{library.error}</Text> : null}
      {library.ready && library.books.length > 0 ? (
        <View style={styles.searchBlock}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜索书名、作者或文件名"
            placeholderTextColor={shelf.muted}
            style={styles.search}
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          <View style={styles.sortRow}>
            {filterChoices.map((choice) => (
              <Pressable
                key={choice.id}
                onPress={() => setStatusFilter(choice.id)}
                style={[styles.sortChip, statusFilter === choice.id && styles.sortChipOn]}
              >
                <Text style={[styles.sortText, statusFilter === choice.id && styles.sortTextOn]}>{choice.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.sortRow}>
            {sortChoices.map((choice) => (
              <Pressable key={choice.id} onPress={() => setSort(choice.id)} style={[styles.sortChip, sort === choice.id && styles.sortChipOn]}>
                <Text style={[styles.sortText, sort === choice.id && styles.sortTextOn]}>{choice.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      </Frosted>
    </View>
  );

  const empty = !library.ready && !library.error ? (
    <View style={styles.empty}>
      <ActivityIndicator color={shelf.accent} />
      <Text style={styles.emptyBody}>正在打开书架…</Text>
    </View>
  ) : library.ready && library.books.length === 0 ? (
    <Frosted tone="shelf" intensity={62} wash={0.42} radius={24} style={styles.empty}>
      <Text style={styles.emptyTitle}>还没有书</Text>
      <Text style={styles.emptyBody}>
        可以从这台设备导入，也可以先放入内置示例，看看翻页、字体和竖排。装到 iPhone 之后，用 Windows 的 BookPush 经家里的 Wi-Fi 把书送进来。
      </Text>
    </Frosted>
  ) : library.ready ? (
    <Frosted tone="shelf" intensity={62} wash={0.42} radius={24} style={styles.empty}>
      <Text style={styles.emptyTitle}>{statusFilter === 'all' ? '没有符合的书' : `没有${readingStatusLabel(statusFilter)}的书`}</Text>
      <Text style={styles.emptyBody}>换一个书名、作者、文件名或阅读状态再看。架子上的书还在。</Text>
    </Frosted>
  ) : undefined;

  return (
    <View style={styles.screen}>
      <LinenWash />
      <FlatList
      style={styles.list}
      data={library.ready ? visibleBooks : []}
      key={columns}
      keyExtractor={(book) => book.id}
      numColumns={columns}
      renderItem={renderItem}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      columnWrapperStyle={columns > 1 ? { gap } : undefined}
      contentContainerStyle={padding}
      contentInsetAdjustmentBehavior="never"
      keyboardShouldPersistTaps="handled"
      removeClippedSubviews={Platform.OS === 'ios'}
      initialNumToRender={9}
      maxToRenderPerBatch={6}
      windowSize={7}
      updateCellsBatchingPeriod={50}
      extraData={pendingDelete}
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
  headerShadow: {
    marginBottom: 20,
    borderRadius: 28,
    shadowColor: '#3c2814',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  headerCard: { padding: 16 },
  header: { flexDirection: 'row', gap: 14, alignItems: 'center', marginBottom: 16 },
  seal: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: shelf.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5c241f',
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  sealText: { color: shelf.accentInk, fontFamily: fonts.display, fontSize: 28 },
  kicker: { color: shelf.muted, letterSpacing: 2.2, fontSize: 11, fontFamily: fonts.ui, fontWeight: '600' },
  title: { color: shelf.ink, fontFamily: fonts.ui, fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -0.4 },
  sub: { color: shelf.muted, fontFamily: fonts.ui, marginTop: 2, lineHeight: 20, fontSize: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  primary: { backgroundColor: shelf.ink, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14 },
  primaryText: { color: shelf.accentInk, fontFamily: fonts.ui, fontSize: 15, fontWeight: '600' },
  secondary: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60,40,20,0.16)',
    backgroundColor: 'rgba(255,252,247,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
  },
  secondaryText: { color: shelf.ink, fontFamily: fonts.ui, fontSize: 15, fontWeight: '500' },
  message: { color: shelf.ink, fontFamily: fonts.ui, marginBottom: 8, lineHeight: 22 },
  searchBlock: { gap: 8 },
  search: {
    backgroundColor: 'rgba(255,252,247,0.72)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontFamily: fonts.ui,
    fontSize: 16,
    color: shelf.ink,
  },
  sortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sortChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60,40,20,0.14)',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,252,247,0.45)',
  },
  sortChipOn: { borderColor: shelf.accent, backgroundColor: 'rgba(142,59,52,0.12)' },
  sortText: { fontFamily: fonts.ui, color: shelf.ink, fontSize: 13 },
  sortTextOn: { color: shelf.accent, fontWeight: '600' },
  empty: { padding: 22, gap: 8, marginTop: 8 },
  emptyTitle: { fontFamily: fonts.ui, fontSize: 28, fontWeight: '700', color: shelf.ink },
  emptyBody: { fontFamily: fonts.ui, color: shelf.muted, lineHeight: 22, fontSize: 15 },
  bookTitle: { marginTop: 8, color: shelf.ink, fontFamily: fonts.ui, fontSize: 14, lineHeight: 18, fontWeight: '600' },
  bookAuthor: { color: shelf.muted, fontFamily: fonts.ui, fontSize: 12, marginTop: 2 },
  status: {
    alignSelf: 'flex-start',
    color: shelf.muted,
    fontFamily: fonts.ui,
    fontSize: 11,
    marginTop: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,252,247,0.7)',
  },
  statusReading: { color: shelf.accent, backgroundColor: 'rgba(142,59,52,0.1)' },
  statusDone: { color: '#2A4A3C', backgroundColor: 'rgba(42,74,60,0.1)' },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 4, marginTop: 6 },
  remove: { color: shelf.accent, fontFamily: fonts.ui, fontSize: 12 },
  removeArmed: { fontWeight: '700' },
  track: { height: 3, backgroundColor: 'rgba(60,40,20,0.12)', borderRadius: 99, marginTop: 8, overflow: 'hidden' },
  fill: { height: 3, backgroundColor: shelf.accent },
  cover: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: shelf.cardSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(42,28,18,0.16)',
    shadowColor: '#2a1c12',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  cloth: { padding: 12, justifyContent: 'flex-end' },
  spine: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 9, backgroundColor: 'rgba(0,0,0,0.22)' },
  clothTitle: { color: '#F6EFE4', fontFamily: fonts.display, fontSize: 18, lineHeight: 24 },
  badge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    backgroundColor: 'rgba(255,250,243,0.92)',
    color: shelf.ink,
    overflow: 'hidden',
    borderRadius: 999,
    fontSize: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontFamily: fonts.ui,
    fontWeight: '600',
  },
  badgeLight: { color: 'rgba(246,239,228,0.8)', fontSize: 10, marginTop: 10, letterSpacing: 1, fontFamily: fonts.ui },
});
