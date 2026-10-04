import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CategoryIcon, CATEGORY_COLORS, CATEGORY_LABEL } from "@/components/SaveCard";
import { createBoard, listBoards } from "@/lib/boards";
import type { BoardSummary, SaveCategory } from "@/lib/database.types";
import { getCategoryCounts } from "@/lib/saves";
import { appAlert } from "@/providers/AlertProvider";
import { isApiError } from "@/providers/AuthProvider";
import { useAuth } from "@/providers/AuthProvider";

const ALL_CATEGORIES: SaveCategory[] = [
  "places", "recipes", "fashion", "shopping", "watch_learn", "inspo",
];

interface CategoryRow {
  category: SaveCategory;
  count: number;
}

// ---------------------------------------------------------------------------
// Create board modal
// ---------------------------------------------------------------------------
function CreateBoardModal({
  visible,
  onCreated,
  onClose,
}: {
  visible: boolean;
  onCreated: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      await createBoard(trimmed);
    } catch (err) {
      appAlert("Error", isApiError(err, "board_name_taken")
        ? `A board called "${trimmed}" already exists.`
        : err instanceof Error ? err.message : "Couldn't create the board.");
      return;
    } finally {
      setLoading(false);
    }
    setName("");
    onCreated();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose} />
      <View className="bg-white rounded-t-3xl px-6 pt-5 pb-10">
        <Text className="text-base font-semibold text-ink mb-4">New board</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Goa trip, Diwali shopping…"
          placeholderTextColor="#8A7E74"
          maxLength={50}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={create}
          className="bg-sand rounded-xl px-4 py-3 text-sm text-ink mb-4"
        />
        <Pressable
          onPress={create}
          disabled={loading || !name.trim()}
          className={`rounded-2xl py-3.5 items-center ${name.trim() ? "bg-coral" : "bg-sand"}`}
        >
          {loading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text className={`font-semibold text-sm ${name.trim() ? "text-white" : "text-muted"}`}>
                Create board
              </Text>
          }
        </Pressable>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Boards screen
// ---------------------------------------------------------------------------
export default function BoardsScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [collections, setCollections] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createVisible, setCreateVisible] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);

    try {
      // One call for every category count, one for the boards (owned and joined).
      const [counts, boards] = await Promise.all([getCategoryCounts(), listBoards()]);
      setCategories(
        ALL_CATEGORIES.map((category) => ({ category, count: counts[category] ?? 0 })).filter(
          (r) => r.count > 0,
        ),
      );
      // Category "shadow" boards exist only to share a category; the category row already covers them.
      setCollections(boards.filter((b) => !(b.source_category && b.role === "owner")));
    } catch (err) {
      console.warn("Failed to load boards:", err);
    }
    setLoading(false);
  }, [session]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const navigateToCategory = (cat: SaveCategory) => {
    router.push({ pathname: "/(app)/board/category", params: { category: cat } } as never);
  };

  const navigateToCollection = (col: BoardSummary) => {
    router.push({ pathname: "/(app)/board/[id]", params: { id: col.id, name: col.name } } as never);
  };

  return (
    <View className="flex-1 bg-cream">
      {/* Top bar */}
      <View style={{ paddingTop: insets.top + 12 }} className="px-5 pb-3 flex-row items-center justify-between">
        <Text className="text-xl font-bold text-ink">Boards</Text>
        <Pressable
          onPress={() => setCreateVisible(true)}
          className="flex-row items-center gap-1 px-3 py-1.5 rounded-lg"
        >
          <Text className="text-coral text-sm font-medium">+ New</Text>
        </Pressable>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#9013BB" size="large" />
        </View>
      ) : (
        <FlatList
          data={[]}
          keyExtractor={() => "placeholder"}
          renderItem={null}
          ListHeaderComponent={
            <View className="px-5">
              {/* Auto categories */}
              {categories.length > 0 && (
                <>
                  <Text className="text-xs text-muted mb-2">Auto categories</Text>
                  {categories.map((row) => {
                    const colors = CATEGORY_COLORS[row.category];
                    const label  = CATEGORY_LABEL[row.category];
                    return (
                      <Pressable
                        key={row.category}
                        onPress={() => navigateToCategory(row.category)}
                        className="flex-row items-center justify-between py-3 border-b border-line"
                      >
                        <View className="flex-row items-center gap-3">
                          <View
                            className="w-9 h-9 rounded-xl items-center justify-center"
                            style={{ backgroundColor: colors.bg }}
                          >
                            <CategoryIcon category={row.category} size={18} />
                          </View>
                          <Text className="text-sm font-medium text-ink">{label}</Text>
                        </View>
                        <Text className="text-sm text-muted">{row.count}</Text>
                      </Pressable>
                    );
                  })}
                </>
              )}

              {/* Custom boards */}
              <Text className="text-xs text-muted mt-5 mb-2">My boards</Text>
              {collections.length === 0 ? (
                <View className="items-center py-10">
                  <Text className="text-2xl">📋</Text>
                  <Text className="mt-3 text-sm text-muted text-center">
                    Create boards to group your saves
                  </Text>
                  <Pressable onPress={() => setCreateVisible(true)} className="mt-4">
                    <Text className="text-sm font-semibold text-coral">Create first board</Text>
                  </Pressable>
                </View>
              ) : (
                collections.map((col) => (
                  <Pressable
                    key={col.id}
                    onPress={() => navigateToCollection(col)}
                    className="flex-row items-center justify-between py-3 border-b border-line"
                  >
                    <View className="flex-row items-center gap-3">
                      <View className="w-9 h-9 rounded-xl bg-sand items-center justify-center">
                        <Text style={{ fontSize: 16 }}>📁</Text>
                      </View>
                      <View>
                        <Text className="text-sm font-medium text-ink">{col.name}</Text>
                        <Text className="text-xs text-muted">custom</Text>
                      </View>
                    </View>
                    <Text className="text-sm text-muted">{col.save_count ?? 0}</Text>
                  </Pressable>
                ))
              )}
            </View>
          }
          contentContainerStyle={{ paddingBottom: 16 }}
        />
      )}

      <CreateBoardModal
        visible={createVisible}
        onCreated={load}
        onClose={() => setCreateVisible(false)}
      />

    </View>
  );
}
