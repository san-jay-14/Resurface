import { useEffect } from "react";
import { Dimensions, Image, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { CategoryEmptyHeader } from "./CategoryEmptyHeader";
import { CategoryIcon } from "@/components/SaveCard";
import type { Save, SaveCategory } from "@/lib/database.types";

const { height: SCREEN_H } = Dimensions.get("window");
const SNAP_HALF = SCREEN_H * 0.45;

interface Props {
  category: "inspo" | "watch_learn";
  saves: Save[];
  onPressSave: (id: string) => void;
  emptyState: { emoji: string; headline: string; subtext: string };
  /** When true the component fills the absolute background zone top-to-bottom */
  fullBleed?: boolean;
  /** Safe-area top inset — required when fullBleed=true */
  insetTop?: number;
}

const COMPACT_CARD_H = 136;
const GAP = 10;
const SCROLL_PX_PER_SEC = 38;

const THEME = {
  inspo:      { bg: "#12081E", label: "Recent saves",   accent: "#9013BB", badge: null },
  watch_learn:{ bg: "#08070E", label: "Recently saved", accent: "#4A0D6E", badge: "NOW SHOWING" },
};

export function RecentSavesSlideshow({
  category, saves, onPressSave, emptyState,
  fullBleed = false, insetTop = 0,
}: Props) {
  const { bg, label, accent, badge } = THEME[category];

  // In full-bleed mode the cards fill from (back-button area + label) to SNAP_HALF
  const LABEL_AREA = 48;
  const CARD_H = fullBleed
    ? Math.max(160, Math.round(SNAP_HALF - insetTop - 60 - LABEL_AREA - 8))
    : COMPACT_CARD_H;

  const CARD_W = fullBleed ? Math.round(CARD_H * 0.68) : 104;
  const CARD_STRIDE = CARD_W + GAP;

  const doubled = [...saves, ...saves];
  const loopWidth = saves.length * CARD_STRIDE;

  const translateX = useSharedValue(0);

  useEffect(() => {
    if (saves.length === 0) return;
    translateX.value = withRepeat(
      withTiming(-loopWidth, {
        duration: Math.round((loopWidth / SCROLL_PX_PER_SEC) * 1000),
        easing: Easing.linear,
      }),
      -1,
      false
    );
  }, [saves.length, loopWidth]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  if (saves.length === 0) {
    if (fullBleed) {
      return (
        <View style={[StyleSheet.absoluteFill, { justifyContent: "center", padding: 16 }]}>
          <CategoryEmptyHeader {...emptyState} dark />
        </View>
      );
    }
    return <CategoryEmptyHeader {...emptyState} dark />;
  }

  const containerStyle = fullBleed
    ? [StyleSheet.absoluteFill, { overflow: "hidden" as const }]
    : [{
        borderRadius: 24,
        backgroundColor: bg,
        overflow: "hidden" as const,
        height: CARD_H + LABEL_AREA + 10,
      }];

  return (
    <View style={containerStyle}>
      {/* Top accent line */}
      <View style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        backgroundColor: accent, opacity: 0.7, zIndex: 2,
      }} />

      {/* Label row — positioned below the back-button in full-bleed */}
      <View style={[
        fullBleed && { paddingTop: insetTop + 60 },
        {
          flexDirection: "row", alignItems: "center", justifyContent: "space-between",
          paddingHorizontal: 16, paddingBottom: 10,
          paddingTop: fullBleed ? undefined : 14,
        },
      ]}>
        <Text style={{
          fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.5)",
          letterSpacing: 1.2, textTransform: "uppercase",
        }}>
          {label}
        </Text>
        {badge && (
          <View style={{
            backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 6,
            paddingHorizontal: 8, paddingVertical: 3,
            borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
          }}>
            <Text style={{ fontSize: 9, fontWeight: "700", color: "rgba(255,255,255,0.6)", letterSpacing: 1.5 }}>
              {badge}
            </Text>
          </View>
        )}
      </View>

      {/* Auto-scrolling strip */}
      <View style={{ overflow: "hidden" }}>
        <Animated.View style={[{ flexDirection: "row", paddingLeft: 16, gap: GAP }, animStyle]}>
          {doubled.map((save, i) => (
            <Pressable
              key={`${save.id}-${i}`}
              onPress={() => onPressSave(save.id)}
              style={{
                width: CARD_W, height: CARD_H,
                borderRadius: fullBleed ? 18 : 14,
                overflow: "hidden",
                backgroundColor: "rgba(255,255,255,0.07)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.1)",
              }}
            >
              {save.thumbnail_url ? (
                <>
                  <Image
                    source={{ uri: save.thumbnail_url }}
                    style={{ width: "100%", height: "100%" }}
                    resizeMode="cover"
                  />
                  <View style={{
                    position: "absolute", bottom: 0, left: 0, right: 0, height: 60,
                    backgroundColor: "rgba(0,0,0,0.5)",
                  }} />
                </>
              ) : (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                  <CategoryIcon category={category as SaveCategory} size={30} />
                </View>
              )}
            </Pressable>
          ))}
        </Animated.View>
      </View>

      {/* Edge vignettes */}
      <View style={{
        position: "absolute", left: 0,
        top: fullBleed ? insetTop + 60 + LABEL_AREA : LABEL_AREA,
        bottom: 0, width: 24,
        backgroundColor: bg, opacity: 0.85,
      }} pointerEvents="none" />
      <View style={{
        position: "absolute", right: 0,
        top: fullBleed ? insetTop + 60 + LABEL_AREA : LABEL_AREA,
        bottom: 0, width: 32,
        backgroundColor: bg, opacity: 0.85,
      }} pointerEvents="none" />

      {/* Bottom purple bloom in full-bleed mode */}
      {fullBleed && (
        <View style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: 80,
          backgroundColor: "rgba(74,13,110,0.25)",
        }} pointerEvents="none" />
      )}
    </View>
  );
}
