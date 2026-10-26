import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { useLibrary, type ShelfBook } from '../storage/library';
import { readAssetBytes } from '../reader/assets';
import { bundledSamples } from '../ui/samples';
import { clothColor, fonts, shelf } from '../ui/theme';

export default function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const library = useLibrary();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const columns = width >= 1100 ? 6 : width >= 840 ? 5 : width >= 640 ? 4 : 3;
  const gap = 16;
  const itemWidth = Math.floor((Math.min(width, 1200) - 36 - gap * (columns - 1)) / columns);

  const importPicked = async () => {
    setMessage(null);
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: true,
      type: ['application/pdf', 'application/epub+zip', 'application/octet-stream', '*/*'],
    });
    if (result.canceled) return;
    setBusy(true);
    try {
      let azw3Count = 0;
      for (const asset of result.assets) {
        const bytes = await readPicked(asset);
        const imported = await library.importBytes(asset.name, bytes);
        if (imported.format === 'azw3') azw3Count += 1;
      }
      setMessage(
        azw3Count > 0
          ? `已放入 ${result.assets.length} 本。其中 ${azw3Count} 本无 DRM 的 AZW3 可以打开阅读。`
          : `已放入 ${result.assets.length} 本。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入失败。');
    } finally {
      setBusy(false);
    }
  };

  const importSamples = async () => {
    setBusy(true);
    setMessage(null);
    try {
      for (const sample of bundledSamples) {
        const bytes = await readAssetBytes(sample.moduleId);
        await library.importBytes(sample.name, bytes);
      }
      setMessage('四本示例已经放上书架，包含一本无 DRM 的 AZW3。它们都是仓库里的原创短篇，没有版权书。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '示例导入失败。');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (book: ShelfBook) => {
    Alert.alert('从书架拿走', `删除《${book.title}》？文件会从这台设备上移除。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => void library.removeBook(book.id) },
    ]);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top + 18, paddingBottom: insets.bottom + 28, paddingHorizontal: 18 }}
    >
      <View style={styles.header}>
        <View style={styles.seal}>
          <Text style={styles.sealText}>书</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>BOOKSHELF</Text>
          <Text style={styles.title}>书架</Text>
          <Text style={styles.sub}>离线阅读。PDF、EPUB，以及没有 DRM 的 AZW3。</Text>
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
      {!library.ready && !library.error ? (
        <View style={styles.empty}>
          <ActivityIndicator color={shelf.accent} />
          <Text style={styles.emptyBody}>正在打开书架…</Text>
        </View>
      ) : null}
      {library.ready && library.books.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>还没有书</Text>
          <Text style={styles.emptyBody}>
            可以从这台设备导入，也可以先放入内置示例，看看翻页、字体和竖排繁体。装到 iPhone 之后，用 Windows 的 BookPush 经家里的 Wi-Fi 把书送进来。
          </Text>
        </View>
      ) : (
        <View style={[styles.grid, { gap }]}>
          {library.books.map((book) => (
            <Pressable
              key={book.id}
              style={{ width: itemWidth }}
              onPress={() => router.push(`/read/${book.id}`)}
              onLongPress={() => confirmDelete(book)}
            >
              <Cover book={book} width={itemWidth} />
              <Text numberOfLines={2} style={styles.bookTitle}>
                {book.title}
              </Text>
              <Text numberOfLines={1} style={styles.bookAuthor}>
                {book.author}
              </Text>
              {book.progress > 0.01 ? (
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.min(100, book.progress * 100)}%` }]} />
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function Cover({ book, width }: { book: ShelfBook; width: number }) {
  const height = Math.round(width * 1.48);
  if (book.coverUri) {
    return (
      <View style={[styles.cover, { width, height }]}>
        <Image source={{ uri: book.coverUri }} style={{ width, height }} resizeMode="cover" />
        <Text style={styles.badge}>{book.format.toUpperCase()}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.cover, styles.cloth, { width, height, backgroundColor: clothColor(book.id) }]}>
      <View style={styles.spine} />
      <Text numberOfLines={4} style={styles.clothTitle}>
        {book.title}
      </Text>
      <Text style={styles.badgeLight}>{book.format.toUpperCase()}</Text>
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
  header: { flexDirection: 'row', gap: 14, alignItems: 'center', marginBottom: 18 },
  seal: {
    width: 54,
    height: 54,
    borderRadius: 8,
    backgroundColor: shelf.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sealText: { color: shelf.accentInk, fontFamily: fonts.display, fontSize: 28 },
  kicker: { color: shelf.muted, letterSpacing: 2, fontSize: 11, fontFamily: fonts.ui },
  title: { color: shelf.ink, fontFamily: fonts.display, fontSize: 40, lineHeight: 46 },
  sub: { color: shelf.muted, fontFamily: fonts.ui, marginTop: 2, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  primary: { backgroundColor: shelf.ink, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  primaryText: { color: shelf.card, fontFamily: fonts.ui, fontSize: 15 },
  secondary: {
    borderWidth: 1,
    borderColor: shelf.line,
    backgroundColor: shelf.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  secondaryText: { color: shelf.ink, fontFamily: fonts.ui, fontSize: 15 },
  message: { color: shelf.ink, fontFamily: fonts.ui, marginBottom: 12, lineHeight: 22 },
  empty: {
    backgroundColor: shelf.card,
    borderRadius: 18,
    padding: 22,
    gap: 8,
    marginTop: 8,
  },
  emptyTitle: { fontFamily: fonts.display, fontSize: 28, color: shelf.ink },
  emptyBody: { fontFamily: fonts.ui, color: shelf.muted, lineHeight: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  bookTitle: { marginTop: 8, color: shelf.ink, fontFamily: fonts.ui, fontSize: 14, lineHeight: 18 },
  bookAuthor: { color: shelf.muted, fontFamily: fonts.ui, fontSize: 12, marginTop: 2 },
  track: { height: 3, backgroundColor: shelf.line, borderRadius: 99, marginTop: 6, overflow: 'hidden' },
  fill: { height: 3, backgroundColor: shelf.accent },
  cover: {
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: shelf.card,
    shadowColor: '#3c2814',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  cloth: { padding: 12, justifyContent: 'flex-end' },
  spine: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 8, backgroundColor: 'rgba(0,0,0,0.25)' },
  clothTitle: { color: '#F6EFE4', fontFamily: fonts.display, fontSize: 18, lineHeight: 24 },
  badge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    backgroundColor: 'rgba(255,250,243,0.92)',
    color: shelf.ink,
    overflow: 'hidden',
    fontSize: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontFamily: fonts.ui,
  },
  badgeLight: { color: 'rgba(246,239,228,0.8)', fontSize: 10, marginTop: 10, letterSpacing: 1, fontFamily: fonts.ui },
});
