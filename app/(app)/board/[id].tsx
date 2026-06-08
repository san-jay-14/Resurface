import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BoardDetailCard } from "@/components/SaveCard";
import { TabBar } from "@/components/TabBar";
import type { Save } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

type SortOption = "recent" | "oldest";

// ---------------------------------------------------------------------------
// Sort sheet
// ---------------------------------------------------------------------------
function SortSheet({
  visible,
  current,
  onSelect,
  onClose,
}: {
  visible: boolean;
  current: SortOption;
  onSelect: (s: SortOption) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} onPress={onClose} />
      <View
        style={{
          backgroundColor: "#111", borderTopLeftRadius: 24, borderTopRightRadius: 24,
          paddingHorizontal: 24, paddingTop: 20, paddingBottom: 44,
        }}
      >
        <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 16 }}>Sort by</Text>
        {(["recent", "oldest"] as SortOption[]).map((opt) => (
          <Pressable
            key={opt}
            onPress={() => { onSelect(opt); onClose(); }}
            style={{
              flexDirection: "row", alignItems: "center", justifyContent: "space-between",
              paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#222",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 14 }}>
              {opt === "recent" ? "Most recent" : "Oldest first"}
            </Text>
            {current === opt && <Ionicons name="checkmark" size={18} color="#FF6B4A" />}
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Board detail screen
// ---------------------------------------------------------------------------
export default function BoardDetail() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const [saves, setSaves] = useState<Save[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<SortOption>("recent");
  const [sortVisible, setSortVisible] = useState(false);

  const fetchSaves = async (quiet = false) => {
    if (!id || !session) return;
    if (!quiet) setLoading(true);
    const { data } = await supabase
      .from("collection_saves")
      .select("saves(*)")
      .eq("collection_id", id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (data ?? []).map((r: any) => r.saves as Save).filter(Boolean) as Save[];
    items.sort((a, b) =>
      sort === "recent"
        ? new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        : new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    setSaves(items);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { void fetchSaves(); }, [id, session, sort]);

  const handleFavorite = async (save: Save) => {
    const next = !save.is_favorite;
    setSaves((prev) => prev.map((s) => s.id === save.id ? { ...s, is_favorite: next } : s));
    const { error } = await supabase.from("saves").update({ is_favorite: next }).eq("id", save.id);
    if (error) setSaves((prev) => prev.map((s) => s.id === save.id ? { ...s, is_favorite: !next } : s));
  };

  const deleteBoard = () => {
    Alert.alert(
      "Delete board",
      `Delete "${name}"? Saves in this board won't be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            await supabase.from("collections").delete().eq("id", id);
            router.back();
          },
        },
      ],
    );
  };

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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 20 }}>
          <Pressable onPress={deleteBoard} hitSlop={8}>
            <Ionicons name="ellipsis-horizontal" size={22} color="#fff" />
          </Pressable>
        </View>
      </View>

      {/* ── Board title + count ── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
        <Text style={{ color: "#fff", fontSize: 32, fontWeight: "800", letterSpacing: -0.5 }}>
          {name ?? "Board"}
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
          gap: 24,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View style={{ flexDirection: "row", gap: 24, alignItems: "center" }}>
          {/* More ideas (inactive) */}
          <Pressable style={{ alignItems: "center", gap: 5 }}>
            <Text style={{ color: "#555", fontSize: 15, fontWeight: "400" }}>More ideas</Text>
            <View style={{ height: 2 }} />
          </Pressable>
          {/* All saves (active) */}
          <Pressable style={{ alignItems: "center", gap: 5 }}>
            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>All saves</Text>
            <View style={{ height: 2, width: "100%", backgroundColor: "#fff", borderRadius: 1 }} />
          </Pressable>
        </View>
        {/* Sort/filter icon */}
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
          <Text style={{ fontSize: 36 }}>📋</Text>
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600", textAlign: "center", marginTop: 16 }}>
            Board is empty
          </Text>
          <Text style={{ color: "#666", fontSize: 13, textAlign: "center", lineHeight: 18, marginTop: 8 }}>
            Open a save's detail view to add it here.
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
          onPress={() => Alert.alert("More ideas", "Coming soon!")}
          style={{ alignItems: "center", gap: 4, paddingHorizontal: 14 }}
        >
          <Ionicons name="sparkles-outline" size={22} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 11 }}>More ideas</Text>
        </Pressable>
      </View>

      <SortSheet
        visible={sortVisible}
        current={sort}
        onSelect={setSort}
        onClose={() => setSortVisible(false)}
      />

      <TabBar active="boards" variant="dark" />
    </View>
  );
}
