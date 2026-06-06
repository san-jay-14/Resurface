import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ACTED_ON_VERB,
  CATEGORY_COLORS,
  CATEGORY_EMOJI,
  CATEGORY_LABEL,
  getSaveTitle,
} from "@/components/SaveCard";
import type { Collection, Save } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

// ---------------------------------------------------------------------------
// Small toast
// ---------------------------------------------------------------------------
function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View className="absolute bottom-8 left-6 right-6 bg-ink/90 rounded-xl px-4 py-3 items-center">
      <Text className="text-white text-sm">{message}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Collections picker modal
// ---------------------------------------------------------------------------
function CollectionsPicker({
  visible,
  saveId,
  userId,
  onClose,
}: {
  visible: boolean;
  saveId: string;
  userId: string;
  onClose: () => void;
}) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [membership, setMembership] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const [colRes, memRes] = await Promise.all([
      supabase.from("collections").select("*").eq("user_id", userId).order("name"),
      supabase.from("collection_saves").select("collection_id").eq("save_id", saveId),
    ]);
    if (colRes.data) setCollections(colRes.data as Collection[]);
    if (memRes.data) setMembership(new Set(memRes.data.map((r) => r.collection_id)));
  };

  useEffect(() => {
    if (visible) void load();
  }, [visible]);

  const toggle = async (col: Collection) => {
    const isMember = membership.has(col.id);
    if (isMember) {
      setMembership((prev) => { const s = new Set(prev); s.delete(col.id); return s; });
      await supabase.from("collection_saves").delete().eq("collection_id", col.id).eq("save_id", saveId);
    } else {
      setMembership((prev) => new Set([...prev, col.id]));
      await supabase.from("collection_saves").insert({ collection_id: col.id, save_id: saveId });
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("collections")
      .insert({ user_id: userId, name })
      .select()
      .single();
    setCreating(false);
    if (error) {
      Alert.alert("Error", error.message.includes("unique") ? "A board with that name already exists." : error.message);
      return;
    }
    setNewName("");
    if (data) setCollections((prev) => [...prev, data as Collection].sort((a, b) => a.name.localeCompare(b.name)));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose} />
      <View className="bg-white rounded-t-3xl px-5 pt-5 pb-10" style={{ maxHeight: "60%" }}>
        <Text className="text-base font-semibold text-ink mb-3">Add to board</Text>
        <ScrollView>
          {collections.map((col) => {
            const on = membership.has(col.id);
            return (
              <Pressable
                key={col.id}
                onPress={() => void toggle(col)}
                className="flex-row items-center justify-between py-3 border-b border-line"
              >
                <Text className="text-sm text-ink">{col.name}</Text>
                <View className={`w-5 h-5 rounded border ${on ? "bg-coral border-coral" : "border-line"} items-center justify-center`}>
                  {on && <Text className="text-white text-xs">✓</Text>}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        {/* Create new board */}
        <View className="flex-row items-center gap-2 mt-3">
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="New board name…"
            placeholderTextColor="#8A7E74"
            maxLength={50}
            className="flex-1 bg-sand rounded-xl px-3 py-2.5 text-sm text-ink"
            returnKeyType="done"
            onSubmitEditing={create}
          />
          <Pressable
            onPress={create}
            disabled={creating || !newName.trim()}
            className="bg-coral rounded-xl px-3 py-2.5"
          >
            {creating
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text className="text-white text-sm font-medium">Create</Text>
            }
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Detail screen
// ---------------------------------------------------------------------------
export default function SaveDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const [save, setSave] = useState<Save | null>(null);
  const [loading, setLoading] = useState(true);
  const [noteText, setNoteText] = useState("");
  const [editingNote, setEditingNote] = useState(false);
  const [boards, setBoards] = useState<string[]>([]); // board names this save belongs to
  const [pickerVisible, setPickerVisible] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const noteRef = useRef<TextInput>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const loadBoards = async (saveId: string) => {
    const { data } = await supabase
      .from("collection_saves")
      .select("collections(name)")
      .eq("save_id", saveId);
    if (data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setBoards((data as any[]).map((r) => (r.collections as { name: string } | null)?.name ?? "").filter(Boolean));
    }
  };

  useEffect(() => {
    if (!id) return;
    const fetch = async () => {
      const { data, error } = await supabase.from("saves").select("*").eq("id", id).single();
      if (error || !data) { setLoading(false); return; }
      setSave(data as Save);
      setNoteText((data as Save).note ?? "");
      setLoading(false);
      await loadBoards(id);
    };
    void fetch();
  }, [id]);

  // Optimistic helper: update save locally + in DB
  const patchSave = async (patch: Partial<Save>, rollback: Partial<Save>) => {
    setSave((prev) => prev ? { ...prev, ...patch } : prev);
    const { error } = await supabase
      .from("saves")
      .update({ ...patch, last_interacted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      setSave((prev) => prev ? { ...prev, ...rollback } : prev);
      showToast("Couldn't save — try again");
    }
  };

  const toggleFavorite = () => {
    if (!save) return;
    void patchSave({ is_favorite: !save.is_favorite }, { is_favorite: save.is_favorite });
  };

  const toggleStatus = (wantActedOn: boolean) => {
    if (!save) return;
    const patch: Partial<Save> = {
      acted_on: wantActedOn,
      acted_on_at: wantActedOn ? new Date().toISOString() : null,
    };
    void patchSave(patch, { acted_on: save.acted_on, acted_on_at: save.acted_on_at });
  };

  const saveNote = async () => {
    if (!save) return;
    setEditingNote(false);
    const trimmed = noteText.trim() || null;
    await patchSave({ note: trimmed }, { note: save.note });
  };

  if (loading) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator color="#FF6B4A" size="large" />
      </View>
    );
  }

  if (!save) {
    return (
      <View className="flex-1 bg-cream items-center justify-center px-8">
        <Text className="text-2xl">🤔</Text>
        <Text className="mt-4 text-base font-semibold text-ink text-center">Save not found</Text>
        <Pressable onPress={() => router.back()} className="mt-4">
          <Text className="text-sm text-coral font-semibold">Go back</Text>
        </Pressable>
      </View>
    );
  }

  const colors = CATEGORY_COLORS[save.category] ?? CATEGORY_COLORS.unsorted;
  const emoji  = CATEGORY_EMOJI[save.category]  ?? "🗂️";
  const label  = CATEGORY_LABEL[save.category]  ?? "Unsorted";
  const verb   = ACTED_ON_VERB[save.category]   ?? "Done";
  const title  = getSaveTitle(save);

  const savedDate = new Date(save.created_at).toLocaleDateString("en-IN", {
    day: "numeric", month: "short",
  });

  return (
    <View className="flex-1 bg-cream">
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header: back + fav + overflow */}
        <View
          style={{ paddingTop: insets.top + 10 }}
          className="px-5 pb-3 flex-row items-center justify-between"
        >
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={{ fontSize: 20 }}>←</Text>
          </Pressable>
          <View className="flex-row gap-4 items-center">
            <Pressable onPress={toggleFavorite} hitSlop={12}>
              <Text style={{ fontSize: 20, color: save.is_favorite ? "#D4537E" : "#8A7E74" }}>
                {save.is_favorite ? "♥" : "♡"}
              </Text>
            </Pressable>
          </View>
        </View>

        <View className="px-5">
          {/* Large thumbnail / fallback */}
          <View
            className="rounded-2xl overflow-hidden items-center justify-center mb-4"
            style={{ height: 160, backgroundColor: save.thumbnail_url ? "#EFE6DC" : colors.bg }}
          >
            {save.thumbnail_url ? (
              <Image source={{ uri: save.thumbnail_url }} className="w-full h-full" resizeMode="cover" />
            ) : (
              <Text style={{ fontSize: 48 }}>{emoji}</Text>
            )}
          </View>

          {/* Title */}
          <Text className="text-lg font-semibold text-ink mb-2 leading-6">{title}</Text>

          {/* Category chip */}
          <View
            className="self-start px-3 py-1 rounded-full mb-4"
            style={{ backgroundColor: colors.bg }}
          >
            <Text style={{ fontSize: 12, color: colors.text, fontWeight: "500" }}>
              {label}
            </Text>
          </View>

          {/* Status toggle */}
          <View className="flex-row bg-sand rounded-xl p-1 mb-4">
            <Pressable
              onPress={() => toggleStatus(false)}
              className={`flex-1 items-center py-2 rounded-lg ${!save.acted_on ? "bg-white" : ""}`}
            >
              <Text className={`text-sm font-medium ${!save.acted_on ? "text-ink" : "text-muted"}`}>
                Saved
              </Text>
            </Pressable>
            <Pressable
              onPress={() => toggleStatus(true)}
              className={`flex-1 items-center py-2 rounded-lg ${save.acted_on ? "bg-white" : ""}`}
            >
              <Text className={`text-sm font-medium ${save.acted_on ? "text-ink" : "text-muted"}`}>
                {verb}
              </Text>
            </Pressable>
          </View>

          {/* Note */}
          {editingNote ? (
            <View className="bg-sand rounded-xl p-3 mb-4">
              <TextInput
                ref={noteRef}
                value={noteText}
                onChangeText={setNoteText}
                multiline
                maxLength={280}
                placeholder="Why did you save this?"
                placeholderTextColor="#8A7E74"
                className="text-sm text-ink leading-5 min-h-16"
                onBlur={saveNote}
                autoFocus
              />
              <Text className="text-xs text-muted text-right mt-1">{noteText.length}/280</Text>
            </View>
          ) : (
            <Pressable
              onPress={() => { setEditingNote(true); setTimeout(() => noteRef.current?.focus(), 50); }}
              className="bg-sand rounded-xl p-3 mb-4 min-h-12 justify-center"
            >
              <Text className={`text-sm ${save.note ? "text-ink" : "text-muted"} leading-5`}>
                {save.note ?? "Add a note — why did you save this?"}
              </Text>
            </Pressable>
          )}

          {/* Boards membership */}
          <Pressable
            onPress={() => setPickerVisible(true)}
            className="flex-row items-center justify-between bg-sand rounded-xl px-3 py-3 mb-4"
          >
            <View>
              <Text className="text-xs text-muted mb-0.5">Boards</Text>
              <Text className="text-sm text-ink">
                {boards.length > 0 ? boards.join(", ") : "Add to a board"}
              </Text>
            </View>
            <Text className="text-muted text-base">›</Text>
          </Pressable>

          {/* Open original */}
          {save.source_url ? (
            <Pressable
              onPress={() => void Linking.openURL(save.source_url!)}
              className="flex-row items-center justify-center gap-2 bg-coral rounded-2xl py-3.5 mb-3"
            >
              <Text className="text-white font-semibold text-sm">Open original</Text>
            </Pressable>
          ) : null}

          {/* Footer */}
          <Text className="text-xs text-muted text-center mt-1">
            Saved {savedDate}
            {boards.length > 0 ? ` · ${boards.join(", ")}` : ""}
          </Text>
        </View>
      </ScrollView>

      <CollectionsPicker
        visible={pickerVisible}
        saveId={save.id}
        userId={session?.user.id ?? ""}
        onClose={async () => {
          setPickerVisible(false);
          await loadBoards(save.id);
        }}
      />

      <Toast message={toast} />
    </View>
  );
}
