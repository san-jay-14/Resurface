import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
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
  Share,
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
  PinCard,
  getSaveTitle,
} from "@/components/SaveCard";
import type { Collection, Save, SaveLocation } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

// ---------------------------------------------------------------------------
// Small toast
// ---------------------------------------------------------------------------
function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View
      style={{
        position: "absolute", bottom: 32, left: 24, right: 24,
        backgroundColor: "rgba(40,40,40,0.95)", borderRadius: 14,
        paddingHorizontal: 16, paddingVertical: 12, alignItems: "center",
      }}
    >
      <Text style={{ color: "#fff", fontSize: 14 }}>{message}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Collections picker (unchanged logic, dark-themed)
// ---------------------------------------------------------------------------
function CollectionsPicker({
  visible, saveId, userId, onClose,
}: { visible: boolean; saveId: string; userId: string; onClose: () => void }) {
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

  useEffect(() => { if (visible) void load(); }, [visible]);

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
      .from("collections").insert({ user_id: userId, name }).select().single();
    setCreating(false);
    if (error) {
      Alert.alert("Error", error.message.includes("unique")
        ? "A board with that name already exists." : error.message);
      return;
    }
    setNewName("");
    if (data) setCollections((prev) =>
      [...prev, data as Collection].sort((a, b) => a.name.localeCompare(b.name)),
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose} />
      <View
        style={{
          backgroundColor: "#111", borderTopLeftRadius: 24, borderTopRightRadius: 24,
          paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40, maxHeight: "60%",
        }}
      >
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 16 }}>
          Add to board
        </Text>
        <ScrollView>
          {collections.map((col) => {
            const on = membership.has(col.id);
            return (
              <Pressable
                key={col.id}
                onPress={() => void toggle(col)}
                style={{
                  flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#222",
                }}
              >
                <Text style={{ color: "#fff", fontSize: 14 }}>{col.name}</Text>
                <View
                  style={{
                    width: 22, height: 22, borderRadius: 6,
                    borderWidth: 1.5,
                    borderColor: on ? "#FF6B4A" : "#444",
                    backgroundColor: on ? "#FF6B4A" : "transparent",
                    alignItems: "center", justifyContent: "center",
                  }}
                >
                  {on && <Ionicons name="checkmark" size={13} color="#fff" />}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="New board name…"
            placeholderTextColor="#555"
            maxLength={50}
            style={{
              flex: 1, backgroundColor: "#1A1A1A", borderRadius: 14,
              paddingHorizontal: 14, paddingVertical: 10, color: "#fff", fontSize: 14,
            }}
            returnKeyType="done"
            onSubmitEditing={create}
          />
          <Pressable
            onPress={create}
            disabled={creating || !newName.trim()}
            style={{
              backgroundColor: newName.trim() ? "#FF6B4A" : "#222",
              borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
              alignItems: "center", justifyContent: "center",
            }}
          >
            {creating
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={{ color: newName.trim() ? "#fff" : "#555", fontSize: 14, fontWeight: "600" }}>
                  Create
                </Text>
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
  const [location, setLocation] = useState<SaveLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [noteText, setNoteText] = useState("");
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [moreSaves, setMoreSaves] = useState<Save[]>([]);
  const noteRef = useRef<TextInput>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    if (!id) return;
    const fetch = async () => {
      const [saveRes, locRes] = await Promise.all([
        supabase.from("saves").select("*").eq("id", id).single(),
        supabase.from("save_locations").select("*").eq("save_id", id).maybeSingle(),
      ]);
      if (saveRes.error || !saveRes.data) { setLoading(false); return; }
      setSave(saveRes.data as Save);
      setNoteText((saveRes.data as Save).note ?? "");
      if (locRes.data) setLocation(locRes.data as SaveLocation);
      setLoading(false);
      // Track last_viewed_at for dormancy calculations
      void supabase.from("saves").update({ last_viewed_at: new Date().toISOString() }).eq("id", id);
    };
    void fetch();
  }, [id]);

  // Fetch more saves in same category
  useEffect(() => {
    if (!save || !session) return;
    const fetchMore = async () => {
      const { data } = await supabase
        .from("saves")
        .select("*")
        .eq("user_id", session.user.id)
        .eq("category", save.category)
        .eq("archived", false)
        .neq("id", save.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (data) setMoreSaves(data as Save[]);
    };
    void fetchMore();
  }, [save]);

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

  const toggleActedOn = () => {
    if (!save) return;
    const wantActedOn = !save.acted_on;
    void patchSave(
      { acted_on: wantActedOn, acted_on_at: wantActedOn ? new Date().toISOString() : null },
      { acted_on: save.acted_on, acted_on_at: save.acted_on_at },
    );
  };

  const saveNote = async () => {
    if (!save) return;
    setNoteExpanded(false);
    const trimmed = noteText.trim() || null;
    await patchSave({ note: trimmed }, { note: save.note });
  };

  const handleShare = async () => {
    if (!save?.source_url) return;
    try { await Share.share({ url: save.source_url, message: save.source_url }); }
    catch { /* user cancelled */ }
  };

  const handleMoreOptions = () => {
    Alert.alert("Options", undefined, [
      { text: "Add to board", onPress: () => setPickerVisible(true) },
      {
        text: "Delete save",
        style: "destructive",
        onPress: () => {
          Alert.alert("Delete this save?", "It'll be archived and recoverable for 30 days.", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete", style: "destructive",
              onPress: async () => {
                await supabase
                  .from("saves")
                  .update({ archived: true, archived_at: new Date().toISOString() })
                  .eq("id", id);
                router.back();
              },
            },
          ]);
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
        <StatusBar style="light" />
        <ActivityIndicator color="#FF6B4A" size="large" />
      </View>
    );
  }

  if (!save) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
        <StatusBar style="light" />
        <Text style={{ fontSize: 32 }}>🤔</Text>
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600", textAlign: "center", marginTop: 16 }}>
          Save not found
        </Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: "#FF6B4A", fontSize: 14, fontWeight: "600" }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const colors = CATEGORY_COLORS[save.category] ?? CATEGORY_COLORS.unsorted;
  const emoji  = CATEGORY_EMOJI[save.category]  ?? "🗂️";
  const label  = CATEGORY_LABEL[save.category]  ?? "Unsorted";
  const verb   = ACTED_ON_VERB[save.category]   ?? "Done";
  const title  = getSaveTitle(save);

  const leftMore = moreSaves.filter((_, i) => i % 2 === 0);
  const rightMore = moreSaves.filter((_, i) => i % 2 !== 0);

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar style="light" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      >
        {/* ── Full-width image ── */}
        <View style={{ position: "relative" }}>
          {save.thumbnail_url ? (
            <Image
              source={{ uri: save.thumbnail_url }}
              style={{ width: "100%", aspectRatio: 0.75 }}
              resizeMode="cover"
            />
          ) : (
            <View
              style={{
                width: "100%", aspectRatio: 0.75,
                backgroundColor: colors.bg,
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 72 }}>{emoji}</Text>
            </View>
          )}

          {/* Back button */}
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            style={{
              position: "absolute", top: insets.top + 10, left: 16,
              backgroundColor: "rgba(40,40,40,0.85)",
              borderRadius: 14, width: 42, height: 42,
              alignItems: "center", justifyContent: "center",
            }}
          >
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>

          {/* Boards button (bottom-right of image) */}
          <Pressable
            onPress={() => setPickerVisible(true)}
            style={{
              position: "absolute", bottom: 14, right: 14,
              backgroundColor: "rgba(0,0,0,0.72)",
              borderRadius: 14, width: 46, height: 46,
              alignItems: "center", justifyContent: "center",
            }}
          >
            <Ionicons name="albums-outline" size={20} color="#fff" />
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          {/* ── Action row ── */}
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 18, gap: 22 }}>
            {/* Favorite */}
            <Pressable onPress={toggleFavorite} hitSlop={8}>
              <Ionicons
                name={save.is_favorite ? "heart" : "heart-outline"}
                size={26}
                color={save.is_favorite ? "#E05888" : "#fff"}
              />
            </Pressable>

            {/* Note / comment */}
            <Pressable
              onPress={() => {
                setNoteExpanded(true);
                setTimeout(() => noteRef.current?.focus(), 60);
              }}
              hitSlop={8}
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <Ionicons name="chatbubble-outline" size={24} color="#fff" />
              {save.note && <Text style={{ color: "#fff", fontSize: 13 }}>1</Text>}
            </Pressable>

            {/* Share */}
            <Pressable onPress={save.source_url ? handleShare : undefined} hitSlop={8}>
              <Ionicons
                name="share-outline"
                size={24}
                color={save.source_url ? "#fff" : "#444"}
              />
            </Pressable>

            {/* More (...) */}
            <Pressable onPress={handleMoreOptions} hitSlop={8}>
              <Ionicons name="ellipsis-horizontal" size={24} color="#fff" />
            </Pressable>

            <View style={{ flex: 1 }} />

            {/* Done / acted-on button */}
            <Pressable
              onPress={toggleActedOn}
              style={{
                backgroundColor: save.acted_on ? "#2A5C0A" : "#FF6B4A",
                borderRadius: 26,
                paddingHorizontal: 22,
                paddingVertical: 13,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>
                {save.acted_on ? `✓ ${verb}` : verb}
              </Text>
            </Pressable>
          </View>

          {/* ── Category chip + location ── */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <View
              style={{
                width: 24, height: 24, borderRadius: 12,
                backgroundColor: colors.bg,
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 12 }}>{emoji}</Text>
            </View>
            <Text style={{ color: "#888", fontSize: 13 }}>{label}</Text>
            {location && (location.city || location.country) && (
              <>
                <Text style={{ color: "#444", fontSize: 13 }}>·</Text>
                <Ionicons name="location-outline" size={13} color="#666" />
                <Text style={{ color: "#666", fontSize: 13 }}>
                  {[location.city, location.country].filter(Boolean).join(", ")}
                </Text>
              </>
            )}
          </View>
          {/* Place name row (places category) */}
          {location?.place_name && (
            <Text style={{ color: "#aaa", fontSize: 13, marginBottom: 10 }} numberOfLines={2}>
              {location.place_name}
            </Text>
          )}

          {/* ── Title + chevron ── */}
          <View
            style={{
              flexDirection: "row", alignItems: "flex-start",
              gap: 10, marginBottom: 10,
            }}
          >
            <Text
              style={{
                flex: 1, color: "#fff", fontSize: 22,
                fontWeight: "800", lineHeight: 28,
              }}
              numberOfLines={noteExpanded ? undefined : 2}
            >
              {title}
            </Text>
            <Pressable
              onPress={() => {
                setNoteExpanded((v) => !v);
                if (!noteExpanded) setTimeout(() => noteRef.current?.focus(), 60);
              }}
              style={{
                backgroundColor: "#2A2A2A", borderRadius: 10,
                width: 34, height: 34, alignItems: "center", justifyContent: "center",
                marginTop: 2,
              }}
            >
              <Ionicons
                name={noteExpanded ? "chevron-up" : "chevron-down"}
                size={15}
                color="#fff"
              />
            </Pressable>
          </View>

          {/* ── Description (caption or AI description) ── */}
          {(save.caption || save.ai_description) && (
            <Text
              style={{
                color: "#888", fontSize: 14, lineHeight: 21,
                marginBottom: 14,
              }}
              numberOfLines={5}
            >
              {save.caption || save.ai_description}
            </Text>
          )}

          {/* ── Keywords / hashtags ── */}
          {save.keywords && save.keywords.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
              {save.keywords.slice(0, 8).map((kw) => (
                <View
                  key={kw}
                  style={{
                    backgroundColor: "#1A1A1A",
                    borderRadius: 20,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderWidth: 1,
                    borderColor: "#2A2A2A",
                  }}
                >
                  <Text style={{ color: "#666", fontSize: 12 }}>
                    {kw.startsWith("#") ? kw : `#${kw}`}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* ── Note area ── */}
          {noteExpanded ? (
            <View
              style={{
                backgroundColor: "#1A1A1A", borderRadius: 16,
                padding: 14, marginBottom: 18,
              }}
            >
              <TextInput
                ref={noteRef}
                value={noteText}
                onChangeText={setNoteText}
                multiline
                maxLength={280}
                placeholder="Why did you save this?"
                placeholderTextColor="#555"
                style={{
                  color: "#fff", fontSize: 14, lineHeight: 21,
                  minHeight: 64,
                }}
              />
              <View
                style={{
                  flexDirection: "row", justifyContent: "space-between",
                  alignItems: "center", marginTop: 10,
                }}
              >
                <Text style={{ color: "#555", fontSize: 12 }}>{noteText.length}/280</Text>
                <Pressable
                  onPress={saveNote}
                  style={{
                    backgroundColor: "#FF6B4A", borderRadius: 10,
                    paddingHorizontal: 16, paddingVertical: 7,
                  }}
                >
                  <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>Save</Text>
                </Pressable>
              </View>
            </View>
          ) : save.note ? (
            <Pressable
              onPress={() => {
                setNoteExpanded(true);
                setTimeout(() => noteRef.current?.focus(), 60);
              }}
              style={{ marginBottom: 18 }}
            >
              <Text style={{ color: "#888", fontSize: 14 }} numberOfLines={1}>
                "{save.note}"
                {"  "}
                <Text style={{ color: "#bbb", fontWeight: "500" }}>Edit note</Text>
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => {
                setNoteExpanded(true);
                setTimeout(() => noteRef.current?.focus(), 60);
              }}
              style={{ marginBottom: 18 }}
            >
              <Text style={{ color: "#444", fontSize: 14 }}>
                Add a note…{"  "}
                <Text style={{ color: "#666" }}>Why did you save this?</Text>
              </Text>
            </Pressable>
          )}

          {/* ── Open original (Visit site) ── */}
          {save.source_url ? (
            <Pressable
              onPress={() => void Linking.openURL(save.source_url!)}
              style={{
                backgroundColor: "#2A2A2A", borderRadius: 32,
                paddingVertical: 17, alignItems: "center", marginBottom: 32,
              }}
            >
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "500" }}>
                Open original
              </Text>
            </Pressable>
          ) : (
            <View style={{ marginBottom: 32 }} />
          )}

          {/* ── More to explore ── */}
          {moreSaves.length > 0 && (
            <>
              <Text
                style={{
                  color: "#fff", fontSize: 18, fontWeight: "700", marginBottom: 14,
                }}
              >
                More in {label.toLowerCase()}
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1, gap: 8 }}>
                  {leftMore.map((s) => (
                    <PinCard
                      key={s.id}
                      save={s}
                      onPress={() =>
                        router.push({
                          pathname: "/(app)/save/[id]",
                          params: { id: s.id },
                        } as never)
                      }
                    />
                  ))}
                </View>
                <View style={{ flex: 1, gap: 8 }}>
                  {rightMore.map((s) => (
                    <PinCard
                      key={s.id}
                      save={s}
                      onPress={() =>
                        router.push({
                          pathname: "/(app)/save/[id]",
                          params: { id: s.id },
                        } as never)
                      }
                    />
                  ))}
                </View>
              </View>
            </>
          )}
        </View>
      </ScrollView>

      <CollectionsPicker
        visible={pickerVisible}
        saveId={save.id}
        userId={session?.user.id ?? ""}
        onClose={() => setPickerVisible(false)}
      />

      <Toast message={toast} />
    </View>
  );
}
