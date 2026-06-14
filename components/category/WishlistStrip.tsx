import { useEffect } from "react";
import { Image, Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { CategoryEmptyHeader } from "./CategoryEmptyHeader";
import { CategoryIcon, getSaveTitle } from "@/components/SaveCard";
import type { Save } from "@/lib/database.types";

interface Props {
  saves: Save[];
  onPressSave: (id: string) => void;
}

const THUMB = 108;
const LABEL_H = 38;
const CARD_H = THUMB + LABEL_H;
const GAP = 10;
const CARD_STRIDE = THUMB + GAP;
const SCROLL_PX_PER_SEC = 30;

const EMPTY = {
  emoji: "🛍️",
  headline: "Your wishlist is empty",
  subtext: "Save product reels and shopping content to build it up",
};

export function WishlistStrip({ saves, onPressSave }: Props) {
  const doubled = [...saves, ...saves];
  const loopWidth = saves.length * CARD_STRIDE;

  const translateX = useSharedValue(0);
  // Shine sweep on header badge
  const shineX = useSharedValue(-120);

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
    shineX.value = withRepeat(
      withTiming(300, { duration: 2400, easing: Easing.inOut(Easing.ease) }),
      -1,
      false
    );
  }, [saves.length, loopWidth]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const shineStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shineX.value }],
  }));

  if (saves.length === 0) {
    return <CategoryEmptyHeader {...EMPTY} />;
  }

  return (
    <View style={{
      marginHorizontal: 16,
      borderRadius: 24,
      backgroundColor: "#FAFAF8",
      overflow: "hidden",
      height: CARD_H + 58,
      borderWidth: 1,
      borderColor: "rgba(0,0,0,0.07)",
      shadowColor: "#9013BB",
      shadowOpacity: 0.08,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 16,
      elevation: 3,
    }}>
      {/* Top accent line */}
      <View style={{ height: 2, backgroundColor: "#9013BB", opacity: 0.6 }} />

      {/* Header row */}
      <View style={{
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10,
      }}>
        <Text style={{
          fontSize: 11, fontWeight: "700", color: "#555",
          letterSpacing: 1.2, textTransform: "uppercase",
        }}>
          Your wishlist
        </Text>

        {/* Animated shine badge */}
        <View style={{
          overflow: "hidden",
          borderRadius: 8,
          backgroundColor: "#F0E8F7",
          paddingHorizontal: 10, paddingVertical: 4,
        }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: "#9013BB" }}>
            {saves.length} items
          </Text>
          <Animated.View style={[{
            position: "absolute", top: 0, bottom: 0, width: 40,
            backgroundColor: "rgba(255,255,255,0.6)",
            transform: [{ skewX: "-20deg" }],
          }, shineStyle]} />
        </View>
      </View>

      {/* Auto-scrolling wishlist */}
      <View style={{ overflow: "hidden" }}>
        <Animated.View style={[{ flexDirection: "row", paddingLeft: 16, gap: GAP }, animStyle]}>
          {doubled.map((save, i) => (
            <Pressable
              key={`${save.id}-${i}`}
              onPress={() => onPressSave(save.id)}
              style={{
                width: THUMB,
                borderRadius: 14, overflow: "hidden",
                backgroundColor: "#FFFFFF",
                shadowColor: "#000",
                shadowOpacity: 0.08,
                shadowOffset: { width: 0, height: 3 },
                shadowRadius: 8,
                elevation: 3,
              }}
            >
              {/* Thumbnail */}
              <View style={{ width: THUMB, height: THUMB, backgroundColor: "#F5F5F5" }}>
                {save.thumbnail_url ? (
                  <Image
                    source={{ uri: save.thumbnail_url }}
                    style={{ width: "100%", height: "100%" }}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                    <CategoryIcon category="shopping" size={28} />
                  </View>
                )}
              </View>
              {/* Title label */}
              <View style={{
                height: LABEL_H, justifyContent: "center",
                paddingHorizontal: 8, backgroundColor: "#FFFFFF",
              }}>
                <Text style={{ fontSize: 10.5, color: "#1A1A1A", lineHeight: 14, fontWeight: "500" }} numberOfLines={2}>
                  {getSaveTitle(save)}
                </Text>
              </View>
            </Pressable>
          ))}
        </Animated.View>
      </View>

      {/* Edge fades */}
      <View style={{
        position: "absolute", right: 0, top: 44, bottom: 0, width: 40,
        backgroundColor: "#FAFAF8", opacity: 0.9,
      }} pointerEvents="none" />
    </View>
  );
}
