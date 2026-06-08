import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  BoardDetailCard,
  CATEGORY_EMOJI,
  CATEGORY_LABEL,
} from "@/components/SaveCard";
import { TabBar } from "@/components/TabBar";
import type { Save, SaveCategory } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

type SortOption = "recent" | "oldest";

export default function CategoryBoard() {
  const { category } = useLocalSearchParams<{ category: SaveCategory }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const [saves, setSaves] = useState<Save[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<SortOption>("recent");
  const [sortVisible, setSortVisible] = useState(false);

  const fetchSaves = async (quiet = false) => {
    if (!category || !session) return;
    if (!quiet) setLoading(true);
    const { data } = await supabase
      .from("saves")
      .select("*")
      .eq("user_id", session.user.id)
      .eq("category", category)
      .eq("archived", false)
      .order("created_at", { ascending: sort === "recent" ? false : true });
    setSaves((data as Save[]) ?? []);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { void fetchSaves(); }, [category, session, sort]);

  const handleFavorite = async (save: Save) => {
    const next = !save.is_favorite;
    setSaves((prev) => prev.map((s) => s.id === save.id ? { ...s, is_favorite: next } : s));
    const { error } = await supabase.from("saves").update({ is_favorite: next }).eq("id", save.id);
    if (error) setSaves((prev) => prev.map((s) => s.id === save.id ? { ...s, is_favorite: !next } : s));
  };

  const label = CATEGORY_LABEL[category as SaveCategory] ?? (category as string) ?? "Category";
  const emoji = CATEGORY_EMOJI[category as SaveCategory] ?? "🗂️";

  const leftItems = saves.filter((_, i) => i % 2 === 0);
  const rightItems = saves.filter((_, i) => i % 2 !== 0);

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar style="light" />

      {/* ── Top bar ── */}
      <View
        style={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 16,
          paddingBottom: 4,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </Pressable>
        <Pressable onPress={() => setSortVisible(true)} hitSlop={8}>
          <Ionicons name="ellipsis-horizontal" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* ── Category title + count ── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
        <Text style={{ color: "#fff", fontSize: 32, fontWeight: "800", letterSpacing: -0.5 }}>
          {emoji} {label}
        </Text>
        <Text style={{ color: "#666", fontSize: 13, marginTop: 4 }}>
          {saves.length} {saves.length === 1 ? "Save" : "Saves"}
        </Text>
      </View>

      {/* ── Sub-tabs ── */}
      <View
        style={{
          flexDirection: "row",
          paddingHorizontal: 16,
          paddingBottom: 10,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View style={{ flexDirection: "row", gap: 24, alignItems: "center" }}>
          <Pressable style={{ alignItems: "center", gap: 5 }}>
            <Text style={{ color: "#555", fontSize: 15, fontWeight: "400" }}>More ideas</Text>
            <View style={{ height: 2 }} />
          </Pressable>
          <Pressable style={{ alignItems: "center", gap: 5 }}>
            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>All saves</Text>
            <View style={{ height: 2, width: "100%", backgroundColor: "#fff", borderRadius: 1 }} />
          </Pressable>
        </View>
        <Pressable onPress={() => setSortVisible(true)} hitSlop={8}>
          <Ionicons name="options-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* ── Content ── */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color="#FF6B4A" size="large" />
        </View>
      ) : saves.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 }}>
          <Text style={{ fontSize: 36 }}>{emoji}</Text>
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600", textAlign: "center", marginTop: 16 }}>
            No {label.toLowerCase()} saves yet
          </Text>
          <Text style={{ color: "#666", fontSize: 13, textAlign: "center", lineHeight: 18, marginTop: 8 }}>
            Share content into Resurface and it'll be categorised here automatically.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 8, paddingTop: 4, paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void fetchSaves(true); }}
              tintColor="#FF6B4A"
            />
          }
        >
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1, gap: 8 }}>
              {leftItems.map((save) => (
                <BoardDetailCard
                  key={save.id}
                  save={save}
                  onPress={() =>
                    router.push({ pathname: "/(app)/save/[id]", params: { id: save.id } } as never)
                  }
                  onFavorite={() => void handleFavorite(save)}
                />
              ))}
            </View>
            <View style={{ flex: 1, gap: 8 }}>
              {rightItems.map((save) => (
                <BoardDetailCard
                  key={save.id}
                  save={save}
                  onPress={() =>
                    router.push({ pathname: "/(app)/save/[id]", params: { id: save.id } } as never)
                  }
                  onFavorite={() => void handleFavorite(save)}
                />
              ))}
            </View>
          </View>
        </ScrollView>
      )}

      {/* ── Floating action bar ── */}
      <View
        style={{
          position: "absolute",
          bottom: Math.max(insets.bottom, 12) + 16,
          left: 28,
          right: 28,
          backgroundColor: "#2A2A2A",
          borderRadius: 40,
          flexDirection: "row",
          paddingVertical: 13,
          paddingHorizontal: 8,
          justifyContent: "space-around",
          alignItems: "center",
        }}
      >
        <Pressable
          onPress={() => setSortVisible(true)}
          style={{ alignItems: "center", gap: 4, paddingHorizontal: 14 }}
        >
          <Ionicons name="reorder-three-outline" size={22} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 11 }}>Organize</Text>
        </Pressable>

        <Pressable
          onPress={() => router.replace("/(app)/search" as never)}
          style={{ alignItems: "center", gap: 4, paddingHorizontal: 14 }}
        >
          <Ionicons name="add-circle-outline" size={22} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 11 }}>Add</Text>
        </Pressable>

        <Pressable
          onPress={() => router.replace("/(app)/" as never)}
          style={{ alignItems: "center", gap: 4, paddingHorizontal: 14 }}
        >
          <Ionicons name="sparkles-outline" size={22} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 11 }}>More ideas</Text>
        </Pressable>
      </View>

      {/* Sort sheet */}
      {sortVisible && (
        <View
          style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            backgroundColor: "#111", borderTopLeftRadius: 24, borderTopRightRadius: 24,
            paddingHorizontal: 24, paddingTop: 20,
            paddingBottom: Math.max(insets.bottom, 24) + 24,
          }}
        >
          <View
            style={{
              width: 36, height: 4, borderRadius: 2, backgroundColor: "#333",
              alignSelf: "center", marginBottom: 20,
            }}
          />
          <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 16 }}>
            Sort by
          </Text>
          {(["recent", "oldest"] as SortOption[]).map((opt) => (
            <Pressable
              key={opt}
              onPress={() => { setSort(opt); setSortVisible(false); }}
              style={{
                flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#222",
              }}
            >
              <Text style={{ color: "#fff", fontSize: 14 }}>
                {opt === "recent" ? "Most recent" : "Oldest first"}
              </Text>
              {sort === opt && <Ionicons name="checkmark" size={18} color="#FF6B4A" />}
            </Pressable>
          ))}
          <Pressable
            onPress={() => setSortVisible(false)}
            style={{ marginTop: 16, paddingVertical: 14, alignItems: "center" }}
          >
            <Text style={{ color: "#666", fontSize: 14 }}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {sortVisible && (
        <Pressable
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: -1 }}
          onPress={() => setSortVisible(false)}
        />
      )}

      <TabBar active="boards" variant="dark" />
    </View>
  );
}
