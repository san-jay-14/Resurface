import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CATEGORY_COLORS, CATEGORY_EMOJI, CATEGORY_LABEL } from "@/components/SaveCard";
import type { Collection, SaveCategory } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
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
  userId,
  onCreated,
  onClose,
}: {
  visible: boolean;
  userId: string;
  onCreated: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    const { error } = await supabase
      .from("collections")
      .insert({ user_id: userId, name: trimmed });
    setLoading(false);
    if (error) {
      Alert.alert("Error", error.message.includes("unique")
        ? `A board called "${trimmed}" already exists.`
        : error.message);
      return;
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
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [createVisible, setCreateVisible] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);

    // Category save counts
    const catPromises = ALL_CATEGORIES.map(async (cat) => {
      const { count } = await supabase
        .from("saves")
        .select("*", { count: "exact", head: true })
        .eq("user_id", session.user.id)
        .eq("category", cat)
        .eq("archived", false);
      return { category: cat, count: count ?? 0 };
    });

    // Custom collections with save counts
    const colRes = await supabase
      .from("collections")
      .select("*, collection_saves(count)")
      .eq("user_id", session.user.id)
      .order("name");

    const [catRows, colData] = await Promise.all([Promise.all(catPromises), colRes]);

    setCategories(catRows.filter((r) => r.count > 0));
    setCollections(
      (colData.data ?? []).map((c) => ({
        ...c,
        save_count: (c.collection_saves as { count: number }[])?.[0]?.count ?? 0,
      })) as Collection[],
    );
    setLoading(false);
  }, [session]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const navigateToCategory = (cat: SaveCategory) => {
    router.push({ pathname: "/(app)/board/category", params: { category: cat } } as never);
  };

  const navigateToCollection = (col: Collection) => {
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
                    const emoji  = CATEGORY_EMOJI[row.category];
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
                            <Text style={{ fontSize: 18 }}>{emoji}</Text>
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
        userId={session?.user.id ?? ""}
        onCreated={load}
        onClose={() => setCreateVisible(false)}
      />

    </View>
  );
}
