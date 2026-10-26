import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LibraryProvider, useLibrary } from '../storage/library';
import { setTransferHooks, startTransfer, stopTransfer } from '../transfer/server';
import { shelf } from '../ui/theme';

function TransferBridge() {
  const library = useLibrary();
  useEffect(() => {
    if (!library.ready) return;
    setTransferHooks({
      getPin: () => library.pin,
      getName: () => library.deviceName,
      importBook: (fileName, bytes) => library.importBytes(fileName, bytes),
    });
    void startTransfer();
    return () => {
      setTransferHooks(null);
      void stopTransfer();
    };
  }, [library.deviceName, library.importBytes, library.pin, library.ready]);
  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <LibraryProvider>
        <TransferBridge />
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: shelf.bg },
          }}
        />
      </LibraryProvider>
    </SafeAreaProvider>
  );
}
