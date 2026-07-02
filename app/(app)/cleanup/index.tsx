import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  PanResponder,
  Pressable,
  Text,
  View,
} from "react-native";
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CategoryIcon, CATEGORY_LABEL } from "@/components/SaveCard";
import type { Save } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W = SCREEN_W - 40;
const SWIPE_THRESHOLD = 90;
const VELOCITY_THRESHOLD = 0.4;

// Spring config that gives the elastic snap-back feel
const SPRING_CONFIG = { damping: 14, stiffness: 180, mass: 0.8 };

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram", youtube: "YouTube", web: "Web",
  whatsapp: "WhatsApp", tiktok: "TikTok", pinterest: "Pinterest",
  twitter: "X/Twitter", linkedin: "LinkedIn", unsorted: "Unknown",
};

function timeSince(dateStr: string): string {
  const months = Math.floor((Date.now() - new Date(dateStr).getTime()) / (30 * 86400000));
  if (months < 1) return "less than a month ago";
  if (months === 1) return "1 month ago";
  return `${months} months ago`;
}

export default function CleanupDeckScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [saves, setSaves] = useState<Save[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [undoStack, setUndoStack] = useState<{ save: Save; action: "archive" | "keep" | "done" }[]>([]);
  const [undoVisible, setUndoVisible] = useState(false);
  const [summary, setSummary] = useState({ archived: 0, kept: 0, done: 0 });
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable refs for access inside PanResponder (which closes over the first render)
  const savesRef = useRef(saves);
  savesRef.current = saves;
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;

  // ─── Reanimated shared values — live on the UI thread ──────────────────────
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  // Card transforms: follows finger 1:1, rotates based on horizontal offset
  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      {
        rotate: `${interpolate(
          translateX.value,
          [-SCREEN_W, 0, SCREEN_W],
          [-22, 0, 22],
          Extrapolation.CLAMP,
        )}deg`,
      },
    ],
  }));

  // Direction label badges (KEEP / ARCHIVE / DONE IT) on the card
  const keepLabelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [20, 70], [0, 1], Extrapolation.CLAMP),
  }));
  const archiveLabelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-70, -20], [1, 0], Extrapolation.CLAMP),
  }));
  const doneLabelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [-70, -20], [1, 0], Extrapolation.CLAMP),
  }));

  // Coloured tint overlays on the card — the visual direction signal
  const keepTintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, SWIPE_THRESHOLD], [0, 0.22], Extrapolation.CLAMP),
  }));
  const archiveTintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-SWIPE_THRESHOLD, 0], [0.22, 0], Extrapolation.CLAMP),
  }));
  const doneTintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [-SWIPE_THRESHOLD, 0], [0.18, 0], Extrapolation.CLAMP),
  }));

  // Back card scales up as you drag the front card — depth parallax
  const nextCardStyle = useAnimatedStyle(() => {
    const drag = Math.max(Math.abs(translateX.value), Math.abs(translateY.value));
    const progress = Math.min(drag / SCREEN_W, 1);
    return {
      transform: [
        { scale: interpolate(progress, [0, 1], [0.93, 1.0], Extrapolation.CLAMP) },
        { translateY: interpolate(progress, [0, 1], [14, 0], Extrapolation.CLAMP) },
      ],
      opacity: interpolate(progress, [0, 0.7], [0.45, 0.9], Extrapolation.CLAMP),
    };
  });

  useEffect(() => {
    void fetchSaves();
  }, [session]);

  const fetchSaves = async () => {
    if (!session) return;
    const { data } = await supabase
      .from("saves")
      .select("*")
      .eq("user_id", session.user.id)
      .eq("archived", false)
      .eq("acted_on", false)
      .order("created_at", { ascending: true })
      .limit(50);
    setSaves((data as Save[]) ?? []);
    setLoading(false);
  };

  const commitAction = (save: Save, action: "archive" | "keep" | "done") => {
    // Reset position immediately so the new card appears at centre
    translateX.value = 0;
    translateY.value = 0;

    setUndoStack((prev) => [...prev, { save, action }]);
    setCurrentIndex((i) => i + 1);
    setSummary((s) => ({
      ...s,
      [action === "archive" ? "archived" : action === "keep" ? "kept" : "done"]:
        s[action === "archive" ? "archived" : action === "keep" ? "kept" : "done"] + 1,
    }));

    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoVisible(true);
    undoTimer.current = setTimeout(() => {
      setUndoVisible(false);
      void persistAction(save, action);
    }, 3000);
  };

  const persistAction = async (save: Save, action: "archive" | "keep" | "done") => {
    if (action === "archive") {
      await supabase.from("archived_saves").insert({
        user_id: save.user_id,
        original_save_id: save.id,
        original_data: save,
      });
      await supabase.from("saves").update({ archived: true, archived_at: new Date().toISOString() }).eq("id", save.id);
    } else if (action === "keep") {
      await supabase.from("saves").update({ last_viewed_at: new Date().toISOString() }).eq("id", save.id);
    } else if (action === "done") {
      await supabase.from("saves").update({ acted_on: true, acted_on_at: new Date().toISOString() }).eq("id", save.id);
    }
  };

  const handleUndo = () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoVisible(false);
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoStack((prev) => prev.slice(0, -1));
    setCurrentIndex((i) => i - 1);
    setSummary((s) => ({
      ...s,
      [last.action === "archive" ? "archived" : last.action === "keep" ? "kept" : "done"]:
        Math.max(0, s[last.action === "archive" ? "archived" : last.action === "keep" ? "kept" : "done"] - 1),
    }));
  };

  // ─── Throw helpers (called from buttons and PanResponder) ──────────────────
  const throwRight = (save: Save) => {
    translateX.value = withTiming(SCREEN_W * 1.5, { duration: 260 }, (finished) => {
      "worklet";
      if (finished) runOnJS(commitAction)(save, "keep");
    });
  };

  const throwLeft = (save: Save) => {
    translateX.value = withTiming(-SCREEN_W * 1.5, { duration: 260 }, (finished) => {
      "worklet";
      if (finished) runOnJS(commitAction)(save, "archive");
    });
  };

  const throwUp = (save: Save) => {
    translateY.value = withTiming(-SCREEN_W, { duration: 260 }, (finished) => {
      "worklet";
      if (finished) runOnJS(commitAction)(save, "done");
    });
  };

  const snapBack = () => {
    translateX.value = withSpring(0, SPRING_CONFIG);
    translateY.value = withSpring(0, SPRING_CONFIG);
  };

  // ─── PanResponder (gesture detection — still JS thread, but smooth because
  //     the Reanimated style callbacks are UI-thread worklets) ─────────────────
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5,

    onPanResponderGrant: () => {
      // Stop any in-progress spring so the card responds instantly to touch
      cancelAnimation(translateX);
      cancelAnimation(translateY);
    },

    onPanResponderMove: (_, g) => {
      translateX.value = g.dx;
      // Only allow upward swipes; add gentle resistance to downward drags
      translateY.value = g.dy < 0 ? g.dy : g.dy * 0.15;
    },

    onPanResponderRelease: (_, g) => {
      const save = savesRef.current[currentIndexRef.current];
      if (!save) return;

      if (g.dx > SWIPE_THRESHOLD || g.vx > VELOCITY_THRESHOLD) {
        throwRight(save);
      } else if (g.dx < -SWIPE_THRESHOLD || g.vx < -VELOCITY_THRESHOLD) {
        throwLeft(save);
      } else if (g.dy < -SWIPE_THRESHOLD || g.vy < -VELOCITY_THRESHOLD) {
        throwUp(save);
      } else {
        snapBack();
      }
    },

    onPanResponderTerminate: () => snapBack(),
  });

  const currentSave = saves[currentIndex];
  const isDone = !loading && currentIndex >= saves.length;

  useEffect(() => {
    if (!loading && (isDone || saves.length === 0)) {
      router.replace({
        pathname: "/(app)/cleanup/summary",
        params: summary,
      } as never);
    }
  }, [isDone, loading, saves.length]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" }}>
        <StatusBar style="dark" />
        <ActivityIndicator color="#9013BB" size="large" />
      </View>
    );
  }

  if (isDone || saves.length === 0) return null;

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={{
        paddingTop: insets.top + 10,
        paddingHorizontal: 20,
        paddingBottom: 16,
        flexDirection: "row",
        alignItems: "center",
      }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={26} color="#1A1A1A" />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={{ color: "#888", fontSize: 13 }}>
            {currentIndex + 1} of {saves.length}
          </Text>
        </View>
        <View style={{ width: 26 }} />
      </View>

      {/* Progress bar */}
      <View style={{ height: 2, backgroundColor: "#F0F0F0", marginHorizontal: 20, borderRadius: 1, marginBottom: 24 }}>
        <View style={{
          height: 2, borderRadius: 1, backgroundColor: "#9013BB",
          width: `${(currentIndex / saves.length) * 100}%`,
        }} />
      </View>

      {/* Card stack */}
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>

        {/* Next card — scales up as you drag (depth effect) */}
        {saves[currentIndex + 1] && (
          <Animated.View
            style={[
              {
                position: "absolute",
                width: CARD_W,
                backgroundColor: "#F5F5F5",
                borderRadius: 24,
                overflow: "hidden",
              },
              nextCardStyle,
            ]}
          >
            {saves[currentIndex + 1].thumbnail_url ? (
              <Image
                source={{ uri: saves[currentIndex + 1].thumbnail_url! }}
                style={{ width: "100%", aspectRatio: 0.85 }}
                resizeMode="cover"
              />
            ) : (
              <View style={{ width: "100%", aspectRatio: 0.85, backgroundColor: "#E5E5E5", alignItems: "center", justifyContent: "center" }}>
                <CategoryIcon category={saves[currentIndex + 1].category} size={48} />
              </View>
            )}
          </Animated.View>
        )}

        {/* Active card — follows finger via Reanimated (UI thread) */}
        {currentSave && (
          <Animated.View
            {...panResponder.panHandlers}
            style={[
              {
                width: CARD_W,
                backgroundColor: "#FFFFFF",
                borderRadius: 24,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: "#E5E5E5",
                shadowColor: "#000",
                shadowOpacity: 0.08,
                shadowOffset: { width: 0, height: 4 },
                shadowRadius: 12,
                elevation: 4,
              },
              cardStyle,
            ]}
          >
            {/* Directional tint overlays */}
            <Animated.View
              pointerEvents="none"
              style={[
                { ...StyleSheet.absoluteFill, backgroundColor: "#22C55E", zIndex: 5 },
                keepTintStyle,
              ]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                { ...StyleSheet.absoluteFill, backgroundColor: "#EF4444", zIndex: 5 },
                archiveTintStyle,
              ]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                { ...StyleSheet.absoluteFill, backgroundColor: "#9013BB", zIndex: 5 },
                doneTintStyle,
              ]}
            />

            {/* Direction labels */}
            <Animated.View style={[{ position: "absolute", top: 20, right: 20, zIndex: 10 }, keepLabelStyle]}>
              <View style={{ backgroundColor: "#22C55E", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 2, borderColor: "#fff" }}>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>KEEP</Text>
              </View>
            </Animated.View>
            <Animated.View style={[{ position: "absolute", top: 20, left: 20, zIndex: 10 }, archiveLabelStyle]}>
              <View style={{ backgroundColor: "#EF4444", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 2, borderColor: "#fff" }}>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>ARCHIVE</Text>
              </View>
            </Animated.View>
            <Animated.View style={[{ position: "absolute", top: 20, alignSelf: "center", zIndex: 10 }, doneLabelStyle]}>
              <View style={{ backgroundColor: "#9013BB", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 2, borderColor: "#fff" }}>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>DONE IT</Text>
              </View>
            </Animated.View>

            {/* Thumbnail */}
            {currentSave.thumbnail_url ? (
              <Image
                source={{ uri: currentSave.thumbnail_url }}
                style={{ width: "100%", aspectRatio: 0.85 }}
                resizeMode="cover"
              />
            ) : (
              <View style={{
                width: "100%", aspectRatio: 0.85,
                backgroundColor: "#F5F5F5",
                alignItems: "center", justifyContent: "center",
              }}>
                <CategoryIcon category={currentSave.category} size={56} />
              </View>
            )}

            {/* Info */}
            <View style={{ padding: 16 }}>
              <Text style={{ color: "#888", fontSize: 12, marginBottom: 6 }}>
                🗓 Saved {timeSince(currentSave.created_at)}
              </Text>
              <Text style={{ color: "#1A1A1A", fontSize: 15, fontWeight: "600", lineHeight: 20 }} numberOfLines={2}>
                {currentSave.title ?? currentSave.ai_description ?? "Saved item"}
              </Text>
              {currentSave.source_platform !== "unsorted" && (
                <Text style={{ color: "#888", fontSize: 12, marginTop: 4 }}>
                  {PLATFORM_LABEL[currentSave.source_platform] ?? currentSave.source_platform}
                </Text>
              )}
              <View style={{
                flexDirection: "row", alignItems: "center", gap: 6,
                marginTop: 10, backgroundColor: "#F5F5F5",
                alignSelf: "flex-start", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
              }}>
                <CategoryIcon category={currentSave.category} size={16} />
                <Text style={{ color: "#888", fontSize: 12 }}>{CATEGORY_LABEL[currentSave.category] ?? "Unsorted"}</Text>
              </View>
            </View>
          </Animated.View>
        )}
      </View>

      {/* Action buttons */}
      <View style={{
        flexDirection: "row", justifyContent: "space-around", alignItems: "center",
        paddingBottom: Math.max(insets.bottom, 24) + 8,
        paddingHorizontal: 24, paddingTop: 16,
      }}>
        <Pressable
          onPress={() => currentSave && throwLeft(currentSave)}
          style={{ alignItems: "center", gap: 6 }}
        >
          <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: "#FFF0F0", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#EF4444" }}>
            <Ionicons name="archive-outline" size={26} color="#EF4444" />
          </View>
          <Text style={{ color: "#888", fontSize: 11 }}>Archive</Text>
        </Pressable>

        <Pressable
          onPress={() => currentSave && throwUp(currentSave)}
          style={{ alignItems: "center", gap: 6 }}
        >
          <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: "#F0E8F7", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#9013BB" }}>
            <Ionicons name="checkmark-circle-outline" size={26} color="#9013BB" />
          </View>
          <Text style={{ color: "#888", fontSize: 11 }}>Done it</Text>
        </Pressable>

        <Pressable
          onPress={() => currentSave && throwRight(currentSave)}
          style={{ alignItems: "center", gap: 6 }}
        >
          <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: "#F0FFF4", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#22C55E" }}>
            <Ionicons name="heart-outline" size={26} color="#22C55E" />
          </View>
          <Text style={{ color: "#888", fontSize: 11 }}>Keep</Text>
        </Pressable>
      </View>

      {/* Swipe hint */}
      <Text style={{ color: "#C0C0C0", fontSize: 11, textAlign: "center", paddingBottom: 8 }}>
        ← Archive · Keep → · ↑ Done it
      </Text>

      {/* Undo snackbar */}
      {undoVisible && (
        <View style={{
          position: "absolute",
          bottom: Math.max(insets.bottom, 20) + 90,
          left: 20, right: 20,
          backgroundColor: "#1A1A1A",
          borderRadius: 14, flexDirection: "row", alignItems: "center",
          paddingHorizontal: 16, paddingVertical: 12,
        }}>
          <Text style={{ color: "#fff", flex: 1, fontSize: 14 }}>Action applied</Text>
          <Pressable onPress={handleUndo}>
            <Text style={{ color: "#9013BB", fontSize: 14, fontWeight: "700" }}>Undo</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// Avoid importing StyleSheet at the top to keep the file focused —
// AbsoluteFill is the only usage and it's a simple object spread.
const StyleSheet = { absoluteFill: { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 } };
