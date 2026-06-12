import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  PanResponder,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CATEGORY_EMOJI, CATEGORY_LABEL } from "@/components/SaveCard";
import type { Save } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W = SCREEN_W - 40;
const SWIPE_THRESHOLD = 100;
const VELOCITY_THRESHOLD = 0.5;

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

  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const rotate = translateX.interpolate({
    inputRange: [-SCREEN_W, 0, SCREEN_W],
    outputRange: ["-25deg", "0deg", "25deg"],
  });
  const keepOpacity = translateX.interpolate({
    inputRange: [0, 80], outputRange: [0, 1], extrapolate: "clamp",
  });
  const archiveOpacity = translateX.interpolate({
    inputRange: [-80, 0], outputRange: [1, 0], extrapolate: "clamp",
  });
  const doneOpacity = translateY.interpolate({
    inputRange: [-80, 0], outputRange: [1, 0], extrapolate: "clamp",
  });

  useEffect(() => {
    void fetchDormantSaves();
  }, [session]);

  const fetchDormantSaves = async () => {
    if (!session) return;
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const viewCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await supabase
      .from("saves")
      .select("*")
      .eq("user_id", session.user.id)
      .eq("archived", false)
      .eq("acted_on", false)
      .is("note", null)
      .lt("created_at", cutoff)
      .or(`last_viewed_at.is.null,last_viewed_at.lt.${viewCutoff}`)
      .order("created_at", { ascending: true })
      .limit(10);

    setSaves((data as Save[]) ?? []);
    setLoading(false);
  };

  const commitAction = async (save: Save, action: "archive" | "keep" | "done") => {
    setUndoStack((prev) => [...prev, { save, action }]);
    setCurrentIndex((i) => i + 1);
    setSummary((s) => ({ ...s, [action === "archive" ? "archived" : action === "keep" ? "kept" : "done"]: s[action === "archive" ? "archived" : action === "keep" ? "kept" : "done"] + 1 }));

    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoVisible(true);
    undoTimer.current = setTimeout(() => {
      setUndoVisible(false);
      void persistAction(save, action);
    }, 3000);

    translateX.setValue(0);
    translateY.setValue(0);
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

  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8,
    onPanResponderMove: (_, g) => {
      translateX.setValue(g.dx);
      if (g.dy < 0) translateY.setValue(g.dy);
    },
    onPanResponderRelease: (_, g) => {
      const save = saves[currentIndex];
      if (!save) return;

      if (g.dx > SWIPE_THRESHOLD || g.vx > VELOCITY_THRESHOLD) {
        Animated.timing(translateX, { toValue: SCREEN_W * 1.5, duration: 250, useNativeDriver: true }).start(() => {
          void commitAction(save, "keep");
        });
      } else if (g.dx < -SWIPE_THRESHOLD || g.vx < -VELOCITY_THRESHOLD) {
        Animated.timing(translateX, { toValue: -SCREEN_W * 1.5, duration: 250, useNativeDriver: true }).start(() => {
          void commitAction(save, "archive");
        });
      } else if (g.dy < -SWIPE_THRESHOLD || g.vy < -VELOCITY_THRESHOLD) {
        Animated.timing(translateY, { toValue: -SCREEN_W, duration: 250, useNativeDriver: true }).start(() => {
          void commitAction(save, "done");
        });
      } else {
        Animated.parallel([
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
        ]).start();
      }
    },
  });

  const currentSave = saves[currentIndex];
  const isDone = !loading && currentIndex >= saves.length;

  // Navigate to summary in an effect — never during render
  useEffect(() => {
    if (!loading && (isDone || (!loading && saves.length === 0))) {
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

  if (isDone || saves.length === 0) {
    return null;
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <StatusBar style="dark" />

      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 20,
          paddingBottom: 16,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
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
        <View
          style={{
            height: 2, borderRadius: 1, backgroundColor: "#9013BB",
            width: `${((currentIndex) / saves.length) * 100}%`,
          }}
        />
      </View>

      {/* Card stack */}
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        {/* Next card (static, shown behind) */}
        {saves[currentIndex + 1] && (
          <View
            style={{
              position: "absolute",
              width: CARD_W,
              backgroundColor: "#F5F5F5",
              borderRadius: 24,
              overflow: "hidden",
              opacity: 0.5,
              transform: [{ scale: 0.94 }, { translateY: 14 }],
            }}
          >
            <View style={{ aspectRatio: 0.75, backgroundColor: "#E5E5E5" }} />
          </View>
        )}

        {/* Active card */}
        {currentSave && (
          <Animated.View
            {...panResponder.panHandlers}
            style={{
              width: CARD_W,
              backgroundColor: "#FFFFFF",
              borderRadius: 24,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: "#E5E5E5",
              transform: [{ translateX }, { translateY }, { rotate }],
            }}
          >
            {/* Direction labels */}
            <Animated.View style={{ position: "absolute", top: 20, right: 20, opacity: keepOpacity, zIndex: 10 }}>
              <View style={{ backgroundColor: "#22C55E", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>KEEP</Text>
              </View>
            </Animated.View>
            <Animated.View style={{ position: "absolute", top: 20, left: 20, opacity: archiveOpacity, zIndex: 10 }}>
              <View style={{ backgroundColor: "#EF4444", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>ARCHIVE</Text>
              </View>
            </Animated.View>
            <Animated.View style={{ position: "absolute", top: 20, alignSelf: "center", opacity: doneOpacity, zIndex: 10 }}>
              <View style={{ backgroundColor: "#A855F7", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
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
              <View
                style={{
                  width: "100%", aspectRatio: 0.85,
                  backgroundColor: "#F5F5F5",
                  alignItems: "center", justifyContent: "center",
                }}
              >
                <Text style={{ fontSize: 56 }}>{CATEGORY_EMOJI[currentSave.category] ?? "🗂️"}</Text>
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
              <View
                style={{
                  flexDirection: "row", alignItems: "center", gap: 6,
                  marginTop: 10, backgroundColor: "#F5F5F5",
                  alignSelf: "flex-start", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
                }}
              >
                <Text style={{ fontSize: 13 }}>{CATEGORY_EMOJI[currentSave.category] ?? "🗂️"}</Text>
                <Text style={{ color: "#888", fontSize: 12 }}>{CATEGORY_LABEL[currentSave.category] ?? "Unsorted"}</Text>
              </View>
            </View>
          </Animated.View>
        )}
      </View>

      {/* Action buttons */}
      <View
        style={{
          flexDirection: "row", justifyContent: "space-around", alignItems: "center",
          paddingBottom: Math.max(insets.bottom, 24) + 8,
          paddingHorizontal: 24, paddingTop: 16,
        }}
      >
        <Pressable
          onPress={() => {
            if (!currentSave) return;
            Animated.timing(translateX, { toValue: -SCREEN_W * 1.5, duration: 250, useNativeDriver: true }).start(() => {
              void commitAction(currentSave, "archive");
            });
          }}
          style={{ alignItems: "center", gap: 6 }}
        >
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#F5F5F5", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="archive-outline" size={24} color="#EF4444" />
          </View>
          <Text style={{ color: "#888", fontSize: 11 }}>Archive</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            if (!currentSave) return;
            Animated.timing(translateY, { toValue: -SCREEN_W, duration: 250, useNativeDriver: true }).start(() => {
              void commitAction(currentSave, "done");
            });
          }}
          style={{ alignItems: "center", gap: 6 }}
        >
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#F5F5F5", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="checkmark-circle-outline" size={24} color="#9013BB" />
          </View>
          <Text style={{ color: "#888", fontSize: 11 }}>Done it</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            if (!currentSave) return;
            Animated.timing(translateX, { toValue: SCREEN_W * 1.5, duration: 250, useNativeDriver: true }).start(() => {
              void commitAction(currentSave, "keep");
            });
          }}
          style={{ alignItems: "center", gap: 6 }}
        >
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#F5F5F5", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="heart-outline" size={24} color="#22C55E" />
          </View>
          <Text style={{ color: "#888", fontSize: 11 }}>Keep</Text>
        </Pressable>
      </View>

      {/* Swipe hint */}
      <Text style={{ color: "#888", fontSize: 11, textAlign: "center", paddingBottom: 8 }}>
        ← Archive · Keep → · ↑ Done it
      </Text>

      {/* Undo snackbar */}
      {undoVisible && (
        <View
          style={{
            position: "absolute",
            bottom: Math.max(insets.bottom, 20) + 80,
            left: 20, right: 20,
            backgroundColor: "#1A1A1A",
            borderRadius: 14, flexDirection: "row", alignItems: "center",
            paddingHorizontal: 16, paddingVertical: 12,
          }}
        >
          <Text style={{ color: "#fff", flex: 1, fontSize: 14 }}>Action applied</Text>
          <Pressable onPress={handleUndo}>
            <Text style={{ color: "#9013BB", fontSize: 14, fontWeight: "700" }}>Undo</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
