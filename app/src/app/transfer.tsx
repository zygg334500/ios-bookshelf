import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLibrary } from '../storage/library';
import { getTransferSnapshot, subscribeTransfer, type TransferSnapshot } from '../transfer/server';
import { QrCode } from '../ui/QrCode';
import { fonts, shelf } from '../ui/theme';

export default function TransferScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const library = useLibrary();
  const [status, setStatus] = useState<TransferSnapshot>(getTransferSnapshot());
  const [name, setName] = useState(library.deviceName);
  const [scanNote, setScanNote] = useState<string | null>(null);

  useEffect(() => subscribeTransfer(setStatus), []);
  useEffect(() => setName(library.deviceName), [library.deviceName]);

  const address = status.ip && status.port ? `http://${status.ip}:${status.port}` : '';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32, paddingHorizontal: 18 }}
    >
      <Pressable onPress={() => router.back()}>
        <Text style={styles.back}>返回书架</Text>
      </Pressable>
      <Text style={styles.kicker}>LOCAL NETWORK</Text>
      <Text style={styles.title}>Wi-Fi 传书</Text>
      <Text style={styles.sub}>
        手机和 Windows 电脑连同一个家里的 Wi-Fi。不要用访客网络，先关掉 VPN。传书时让 BookShelf 留在前台。
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>这台设备</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          onEndEditing={() => void library.updateDeviceName(name)}
          style={styles.input}
        />
        <Text style={styles.label}>配对码</Text>
        <Text style={styles.pin}>{library.pin}</Text>
        <Text style={styles.hint}>在 BookPush 里输入同一组数字。它只能挡住同网里随手乱传，不能加密内容。</Text>
        <Pressable onPress={() => void library.regeneratePin()}>
          <Text style={styles.link}>换一个配对码</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>状态</Text>
        <Text style={styles.body}>{status.detail}</Text>
        {status.error ? <Text style={styles.error}>{status.error}</Text> : null}
        {address ? (
          <>
            <Text style={styles.address}>{address}</Text>
            <Text style={styles.hint}>
              {status.bonjour ? '已用 Bonjour 广播 _bookshelf._tcp。' : '没有广播成功时，把上面的地址填进 BookPush。'}
            </Text>
            <View style={styles.qr}>
              <QrCode value={address} />
            </View>
          </>
        ) : (
          <Text style={styles.hint}>装进 iPhone 并允许「本地网络」之后，这里会出现 IP 和二维码。</Text>
        )}
        {status.lastTitle ? <Text style={styles.body}>最近收到《{status.lastTitle}》</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>不用 Wi-Fi 时</Text>
        <Text style={styles.body}>
          用数据线连接电脑，在 Windows 的 Apple 设备 / iTunes 文件共享里把 PDF、EPUB、AZW3 放进 BookShelf 文稿，然后点下面的按钮。
        </Text>
        <Pressable
          style={styles.button}
          onPress={() => {
            void library.importShared().then((count) => {
              setScanNote(count ? `从文件共享导入了 ${count} 本。` : '文稿根目录和 Inbox 里没有新的书籍文件。');
            }).catch((error: unknown) => {
              setScanNote(error instanceof Error ? error.message : '扫描失败。');
            });
          }}
        >
          <Text style={styles.buttonText}>扫描文件共享</Text>
        </Pressable>
        {scanNote ? <Text style={styles.hint}>{scanNote}</Text> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: shelf.bg },
  back: { color: shelf.accent, fontFamily: fonts.ui, marginBottom: 12 },
  kicker: { color: shelf.muted, letterSpacing: 2, fontSize: 11, fontFamily: fonts.ui },
  title: { fontFamily: fonts.display, fontSize: 40, color: shelf.ink, marginTop: 4 },
  sub: { fontFamily: fonts.ui, color: shelf.muted, lineHeight: 22, marginTop: 8, marginBottom: 16 },
  card: { backgroundColor: shelf.card, borderRadius: 18, padding: 16, marginBottom: 12, gap: 6 },
  label: { fontFamily: fonts.ui, color: shelf.muted, fontSize: 12, letterSpacing: 1 },
  input: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: shelf.ink,
    borderBottomWidth: 1,
    borderBottomColor: shelf.line,
    paddingVertical: 4,
  },
  pin: { fontFamily: fonts.display, fontSize: 48, letterSpacing: 8, color: shelf.ink },
  hint: { fontFamily: fonts.ui, color: shelf.muted, lineHeight: 20 },
  body: { fontFamily: fonts.ui, color: shelf.ink, lineHeight: 22 },
  error: { fontFamily: fonts.ui, color: shelf.accent, lineHeight: 22 },
  address: { fontFamily: fonts.ui, fontSize: 18, color: shelf.ink, marginTop: 8 },
  link: { fontFamily: fonts.ui, color: shelf.accent, marginTop: 4 },
  qr: { alignItems: 'flex-start', marginTop: 8 },
  button: {
    alignSelf: 'flex-start',
    marginTop: 8,
    backgroundColor: shelf.ink,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonText: { color: shelf.card, fontFamily: fonts.ui },
});
