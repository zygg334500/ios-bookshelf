import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLibrary } from '../storage/library';
import { getTransferSnapshot, restartTransfer, subscribeTransfer, type TransferSnapshot } from '../transfer/server';
import { QrCode } from '../ui/QrCode';
import { shelfContentPadding } from '../ui/insets';
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
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ ...shelfContentPadding(insets), paddingBottom: insets.bottom + 28 }}
    >
      <Pressable onPress={() => router.back()}>
        <Text style={styles.back}>返回书架</Text>
      </Pressable>
      <Text style={styles.kicker}>LOCAL NETWORK</Text>
      <Text style={styles.title}>Wi-Fi 传书</Text>
      <Text style={styles.sub}>
        搜索失败时不必重装。下面的 IP、端口和配对码就是手动通道，BookPush 搜到 0 台时直接填这三项。
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
        <Text style={styles.label}>手工填写</Text>
        <Text style={styles.fieldLabel}>IP</Text>
        <Text selectable style={styles.address}>{status.ip ?? '装进 iPhone 并连上 Wi-Fi 后出现'}</Text>
        <Text style={styles.fieldLabel}>端口</Text>
        <Text selectable style={styles.port}>{status.port ?? '27780'}</Text>
        <Text style={styles.hint}>配对码在上面。它不写入 Bonjour，只在 BookPush 里再输入一次。</Text>
        {address ? (
          <View style={styles.qr}>
            <QrCode value={address} />
          </View>
        ) : null}
        <Text style={styles.body}>{status.detail}</Text>
        {status.error ? <Text style={styles.error}>{status.error}</Text> : null}
        <Text style={styles.hint}>
          {status.bonjour ? '已广播 _bookshelf._tcp。' : '还没有广播成功时，Windows 搜索会是 0 台，用上面的 IP 和端口即可。'}
        </Text>
        <Pressable style={styles.button} onPress={() => void restartTransfer()}>
          <Text style={styles.buttonText}>重新监听</Text>
        </Pressable>
        {status.lastTitle ? <Text style={styles.body}>最近收到《{status.lastTitle}》</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>搜不到手机时</Text>
        <Text style={styles.body}>1. 第一次会弹出「本地网络」。若之前点了不允许：设置 → 隐私与安全性 → 本地网络 → 打开 BookShelf。</Text>
        <Text style={styles.body}>2. 手机和电脑连同一个家里的 Wi-Fi，不要用访客网络，两边关掉 VPN。这一页留在前台。</Text>
        <Text style={styles.body}>3. Windows 防火墙允许 Python 在专用网络收发 UDP 5353。BookPush 点「重新搜索」。</Text>
        <Text style={styles.body}>4. 仍然是 0 台：把 IP、端口、配对码填进 BookPush，再传书。</Text>
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
  fieldLabel: { fontFamily: fonts.ui, color: shelf.muted, fontSize: 12, marginTop: 8 },
  address: { fontFamily: fonts.ui, fontSize: 28, color: shelf.ink },
  port: { fontFamily: fonts.display, fontSize: 36, letterSpacing: 2, color: shelf.ink },
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
