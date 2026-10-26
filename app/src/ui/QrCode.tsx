import { useMemo } from 'react';
import { View } from 'react-native';
import { create as createQr } from 'qrcode';

type Props = { value: string; size?: number };

export function QrCode({ value, size = 168 }: Props) {
  const cells = useMemo(() => {
    const qr = createQr(value, { errorCorrectionLevel: 'M' });
    return { size: qr.modules.size, data: qr.modules.data };
  }, [value]);
  const cell = size / cells.size;
  return (
    <View style={{ width: size, height: size, backgroundColor: '#fffaf3', padding: 8 }}>
      <View style={{ width: size - 16, height: size - 16 }}>
        {Array.from({ length: cells.size }, (_, y) => (
          <View key={y} style={{ flexDirection: 'row', height: cell }}>
            {Array.from({ length: cells.size }, (_, x) => (
              <View
                key={x}
                style={{
                  width: cell,
                  height: cell,
                  backgroundColor: cells.data[y * cells.size + x] ? '#1E1A16' : 'transparent',
                }}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}
