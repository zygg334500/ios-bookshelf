import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView, type BlurTint } from 'expo-blur';
import type { ReaderTheme } from '../core/types';

export type GlassTone = 'shelf' | ReaderTheme;

const TINT: Record<GlassTone, BlurTint> = {
  shelf: 'systemChromeMaterialLight',
  light: 'systemUltraThinMaterialLight',
  sepia: 'systemThinMaterialLight',
  dark: 'systemUltraThinMaterialDark',
};

const WASH: Record<GlassTone, string> = {
  shelf: 'rgba(247, 242, 234, 0.42)',
  light: 'rgba(251, 249, 244, 0.28)',
  sepia: 'rgba(244, 236, 216, 0.38)',
  dark: 'rgba(22, 22, 24, 0.34)',
};

type Props = {
  children?: ReactNode;
  tone?: GlassTone;
  /** 1–100. Lower keeps reading chrome from covering the glyphs. */
  intensity?: number;
  /** Extra milk on top of the system material, 0–1. */
  wash?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Apple system materials via expo-blur. iOS 16.4+ (the Expo SDK floor) gets a real
 * UIVisualEffectView; web uses backdrop-filter. One BlurView per chrome surface —
 * not per bookshelf cell — so the shelf list can keep scrolling smoothly.
 */
export function Frosted({ children, tone = 'shelf', intensity = 56, wash = 0.34, radius, style }: Props) {
  const shape = radius != null ? { borderRadius: radius, overflow: 'hidden' as const } : null;
  const milk = wash <= 0 ? null : withAlpha(WASH[tone], wash);
  return (
    <BlurView intensity={intensity} tint={TINT[tone]} style={[shape, style]}>
      {milk ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: milk }]} /> : null}
      {children}
    </BlurView>
  );
}

/** Soft color fields so glass has something to frost on the warm shelf. */
export function LinenWash() {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wash]}>
      <View style={styles.bloomWarm} />
      <View style={styles.bloomCool} />
      <View style={styles.bloomPaper} />
    </View>
  );
}

function withAlpha(color: string, wash: number): string {
  const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return color;
  const alpha = Math.min(0.85, Math.max(0, wash));
  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`;
}

const styles = StyleSheet.create({
  wash: { overflow: 'hidden' },
  bloomWarm: {
    position: 'absolute',
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: 'rgba(196, 112, 86, 0.16)',
    top: -90,
    right: -70,
  },
  bloomCool: {
    position: 'absolute',
    width: 380,
    height: 380,
    borderRadius: 190,
    backgroundColor: 'rgba(78, 112, 132, 0.12)',
    bottom: -40,
    left: -120,
  },
  bloomPaper: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(255, 248, 236, 0.55)',
    top: 280,
    left: 30,
  },
});
