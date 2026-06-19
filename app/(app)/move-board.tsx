import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CATEGORY_EMOJI, CATEGORY_LABEL, getSaveTitle } from "@/components/SaveCard";
import type { Save, SaveCategory } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

const ALL_CATEGORIES: SaveCategory[] = [
  "places", "recipes", "fashion", "shopping", "watch_learn", "inspo", "unsorted",
];

type Selection =
  | { type: "category"; value: SaveCategory }
  | { type: "collection"; value: string; name: string };

interface CollectionWithCount {
  id: string;
  name: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------
function BoardRow({
  emoji, label, count, selected, onPress,
}: { emoji: string; label: string; count: number; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        paddingVertical: 13, paddingHorizontal: 16,
        borderBottomWidth: 1, borderBottomColor: "#F0F0F0",
        backgroundColor: selected ? "#FAF6FD" : "#FFFFFF",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
        <View style={{
          width: 34, height: 34, borderRadius: 10,
          backgroundColor: "#F5F5F5", alignItems: "center", justifyContent: "center",
        }}>
          <Text style={{ fontSize: 16 }}>{emoji}</Text>
        </View>
        <Text style={{ fontSize: 15, color: "#1A1A1A", fontWeight: selected ? "700" : "500", flex: 1 }} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ fontSize: 12, color: "#888" }}>
          {count} {count === 1 ? "save" : "saves"}
        </Text>
        <View
          style={{
            width: 22, height: 22, borderRadius: 11, borderWidth: 1.5,
            borderColor: selected ? "#9013BB" : "#E5E5E5",
            backgroundColor: selected ? "#9013BB" : "transparent",
            alignItems: "center", justifyContent: "center",
          }}
        >
          {selected && <Ionicons name="checkmark" size={13} color="#fff" />}
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
export default function MoveBoardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const [save, setSave] = useState<Save | null>(null);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [collections, setCollections] = useState<CollectionWithCount[]>([]);
  const [membership, setMembership] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<Selection | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  useEffect(() => {
    if (!id || !session) return;
    void (async () => {
      setLoading(true);

      const [saveRes, savesRes, colRes, memRes] = await Promise.all([
        supabase.from("saves").select("*").eq("id", id).single(),
        supabase.from("saves").select("category").eq("user_id", session.user.id).eq("archived", false),
        supabase.from("collections").select("id, name, collection_saves(save_id)").eq("user_id", session.user.id).order("name"),
        supabase.from("collection_saves").select("collection_id").eq("save_id", id),
      ]);

      if (saveRes.data) {
        const s = saveRes.data as Save;
        setSave(s);
        setSelected({ type: "category", value: s.category });
      }

      const counts: Record<string, number> = {};
      for (const row of savesRes.data ?? []) {
        const cat = row.category as string;
        counts[cat] = (counts[cat] ?? 0) + 1;
      }
      setCategoryCounts(counts);

      type RawCol = { id: string; name: string; collection_saves: { save_id: string }[] };
      setCollections(
        ((colRes.data ?? []) as unknown as RawCol[]).map((c) => ({
          id: c.id,
          name: c.name,
          count: c.collection_saves?.length ?? 0,
        })),
      );

      setMembership(new Set((memRes.data ?? []).map((r) => r.collection_id as string)));
      setLoading(false);
    })();
  }, [id, session]);

  const canConfirm =
    selected !== null &&
    !(selected.type === "category" && save && selected.value === save.category) &&
    !(selected.type === "collection" && membership.has(selected.value));

  const createBoard = async () => {
    const name = newName.trim();
    if (!name || !session) return;
    setCreateLoading(true);
    const { data, error } = await supabase
      .from("collections").insert({ user_id: session.user.id, name }).select().single();
    setCreateLoading(false);
    if (error) {
      Alert.alert("Error", error.message.includes("unique")
        ? "A board with that name already exists." : error.message);
      return;
    }
    if (data) {
      setCollections((prev) =>
        [...prev, { id: data.id, name: data.name, count: 0 }].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setSelected({ type: "collection", value: data.id, name: data.name });
    }
    setNewName("");
    setCreatingNew(false);
  };

  const confirmMove = async () => {
    if (!selected || !id) return;
    setConfirming(true);
    if (selected.type === "category") {
      await supabase
        .from("saves")
        .update({ category: selected.value, last_interacted_at: new Date().toISOString() })
        .eq("id", id);
    } else {
      await supabase.from("collection_saves").insert({ collection_id: selected.value, save_id: id });
    }
    setConfirming(false);
    setConfirmVisible(false);
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={{
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 12,
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        borderBottomWidth: 1, borderBottomColor: "#F0F0F0",
      }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color="#1A1A1A" />
        </Pressable>
        <Text style={{ fontSize: 17, fontWeight: "700", color: "#1A1A1A" }}>
          Move to board
        </Text>
        <Pressable
          onPress={() => canConfirm && setConfirmVisible(true)}
          disabled={!canConfirm}
          hitSlop={8}
          style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: canConfirm ? "#9013BB" : "#F0F0F0",
            alignItems: "center", justifyContent: "center",
          }}
        >
          <Ionicons name="checkmark" size={20} color={canConfirm ? "#fff" : "#BBB"} />
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color="#9013BB" size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {save && (
            <Text style={{ color: "#888", fontSize: 12.5, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 }} numberOfLines={1}>
              Moving "{getSaveTitle(save)}"
            </Text>
          )}

          <Text style={{ fontSize: 12, fontWeight: "700", color: "#999", letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
            CATEGORY BOARDS
          </Text>
          {ALL_CATEGORIES.map((cat) => (
            <BoardRow
              key={cat}
              emoji={CATEGORY_EMOJI[cat]}
              label={CATEGORY_LABEL[cat]}
              count={categoryCounts[cat] ?? 0}
              selected={selected?.type === "category" && selected.value === cat}
              onPress={() => setSelected({ type: "category", value: cat })}
            />
          ))}

          <Text style={{ fontSize: 12, fontWeight: "700", color: "#999", letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8 }}>
            YOUR BOARDS
          </Text>
          {collections.map((col) => (
            <BoardRow
              key={col.id}
              emoji="📌"
              label={col.name}
              count={col.count}
              selected={selected?.type === "collection" && selected.value === col.id}
              onPress={() => setSelected({ type: "collection", value: col.id, name: col.name })}
            />
          ))}

          {/* Create new board */}
          {creatingNew ? (
            <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 14 }}>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="New board name…"
                placeholderTextColor="#888"
                maxLength={50}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={createBoard}
                style={{
                  flex: 1, backgroundColor: "#F5F5F5", borderRadius: 14,
                  paddingHorizontal: 14, paddingVertical: 10, color: "#1A1A1A", fontSize: 14,
                }}
              />
              <Pressable
                onPress={createBoard}
                disabled={createLoading || !newName.trim()}
                style={{
                  backgroundColor: newName.trim() ? "#9013BB" : "#F0F0F0",
                  borderRadius: 14, paddingHorizontal: 16, alignItems: "center", justifyContent: "center",
                }}
              >
                {createLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: newName.trim() ? "#fff" : "#888", fontSize: 14, fontWeight: "600" }}>Create</Text>
                }
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => setCreatingNew(true)}
              style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 14 }}
            >
              <Ionicons name="add-circle-outline" size={20} color="#9013BB" />
              <Text style={{ color: "#9013BB", fontSize: 14, fontWeight: "600" }}>New board</Text>
            </Pressable>
          )}
        </ScrollView>
      )}

      {/* Confirmation modal */}
      <Modal visible={confirmVisible} transparent animationType="fade" onRequestClose={() => setConfirmVisible(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
          <View style={{ backgroundColor: "#FFFFFF", borderRadius: 20, padding: 22, width: "100%" }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: "#1A1A1A", marginBottom: 8 }}>
              {selected?.type === "category"
                ? `Move to ${CATEGORY_LABEL[selected.value]}?`
                : `Add to "${selected?.name}"?`}
            </Text>
            <Text style={{ fontSize: 13, color: "#888", lineHeight: 18, marginBottom: 20 }}>
              {selected?.type === "category"
                ? "This save will be re-categorized and moved out of its current board."
                : "This save will be added to this board alongside its current category."}
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => setConfirmVisible(false)}
                style={{ flex: 1, paddingVertical: 13, borderRadius: 14, backgroundColor: "#F5F5F5", alignItems: "center" }}
              >
                <Text style={{ color: "#1A1A1A", fontSize: 14, fontWeight: "600" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirmMove}
                disabled={confirming}
                style={{ flex: 1, paddingVertical: 13, borderRadius: 14, backgroundColor: "#9013BB", alignItems: "center" }}
              >
                {confirming
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>Confirm</Text>
                }
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
