import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
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
  CategoryIcon,
  CATEGORY_COLORS,
  CATEGORY_EMOJI,
  CATEGORY_LABEL,
  PinCard,
  getSaveTitle,
} from "@/components/SaveCard";
import type { Save, SaveLocation } from "@/lib/database.types";
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
// More-options sheet — styled replacement for the old native Alert menu.
// ---------------------------------------------------------------------------
function MoreOptionsSheet({
  visible, onClose, onMoveToBoard, onDelete,
}: { visible: boolean; onClose: () => void; onMoveToBoard: () => void; onDelete: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} onPress={onClose} />
      <View
        style={{
          backgroundColor: "#FFFFFF", borderTopLeftRadius: 24, borderTopRightRadius: 24,
          paddingTop: 10, paddingBottom: 28,
        }}
      >
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "#E5E5E5", alignSelf: "center", marginBottom: 6 }} />

        <Pressable
          onPress={onMoveToBoard}
          style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 16 }}
        >
          <View style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: "#F0E8F7", alignItems: "center", justifyContent: "center",
          }}>
            <Ionicons name="albums-outline" size={18} color="#9013BB" />
          </View>
          <Text style={{ fontSize: 15, color: "#1A1A1A", fontWeight: "500" }}>Move to board</Text>
        </Pressable>

        <View style={{ height: 1, backgroundColor: "#F0F0F0", marginLeft: 70 }} />

        <Pressable
          onPress={onDelete}
          style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 16 }}
        >
          <View style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: "#FDEAEA", alignItems: "center", justifyContent: "center",
          }}>
            <Ionicons name="trash-outline" size={18} color="#E03131" />
          </View>
          <Text style={{ fontSize: 15, color: "#E03131", fontWeight: "500" }}>Delete save</Text>
        </Pressable>

        <Pressable
          onPress={onClose}
          style={{ alignItems: "center", paddingTop: 14, paddingHorizontal: 20 }}
        >
          <Text style={{ fontSize: 14, color: "#888", fontWeight: "600" }}>Cancel</Text>
        </Pressable>
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
  const [moreVisible, setMoreVisible] = useState(false);
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

  // Re-fetch the save when this screen regains focus (e.g. returning from
  // the Move to board screen) so category/board changes show up. Skips the
  // first focus, which the mount effect above already handles.
  const didMountRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      if (!didMountRef.current) { didMountRef.current = true; return; }
      void supabase.from("saves").select("*").eq("id", id).single().then(({ data }) => {
        if (data) setSave(data as Save);
      });
    }, [id]),
  );

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

  const handleDelete = () => {
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
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" }}>
        <StatusBar style="dark" />
        <ActivityIndicator color="#9013BB" size="large" />
      </View>
    );
  }

  if (!save) {
    return (
      <View style={{ flex: 1, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
        <StatusBar style="dark" />
        <Text style={{ fontSize: 32 }}>🤔</Text>
        <Text style={{ color: "#1A1A1A", fontSize: 16, fontWeight: "600", textAlign: "center", marginTop: 16 }}>
          Save not found
        </Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: "#9013BB", fontSize: 14, fontWeight: "600" }}>Go back</Text>
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
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <StatusBar style="dark" />

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
              <CategoryIcon category={save.category} size={72} />
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
            onPress={() => router.push({ pathname: "/(app)/move-board", params: { id: save.id } } as never)}
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
                color={save.is_favorite ? "#E05888" : "#1A1A1A"}
              />
            </Pressable>

            {/* Share */}
            <Pressable onPress={save.source_url ? handleShare : undefined} hitSlop={8}>
              <Ionicons
                name="share-outline"
                size={24}
                color={save.source_url ? "#1A1A1A" : "#C0C0C0"}
              />
            </Pressable>

            {/* More (...) */}
            <Pressable onPress={() => setMoreVisible(true)} hitSlop={8}>
              <Ionicons name="ellipsis-horizontal" size={24} color="#1A1A1A" />
            </Pressable>

            <View style={{ flex: 1 }} />

            {/* Done / acted-on button */}
            <Pressable
              onPress={toggleActedOn}
              style={{
                backgroundColor: save.acted_on ? "#2A5C0A" : "#9013BB",
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
                flex: 1, color: "#1A1A1A", fontSize: 22,
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
                backgroundColor: "#F5F5F5", borderRadius: 10,
                width: 34, height: 34, alignItems: "center", justifyContent: "center",
                marginTop: 2,
              }}
            >
              <Ionicons
                name={noteExpanded ? "chevron-up" : "chevron-down"}
                size={15}
                color="#1A1A1A"
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
                    backgroundColor: "#F5F5F5",
                    borderRadius: 20,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderWidth: 1,
                    borderColor: "#E5E5E5",
                  }}
                >
                  <Text style={{ color: "#888", fontSize: 12 }}>
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
                backgroundColor: "#F5F5F5", borderRadius: 16,
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
                placeholderTextColor="#888"
                style={{
                  color: "#1A1A1A", fontSize: 14, lineHeight: 21,
                  minHeight: 64,
                }}
              />
              <View
                style={{
                  flexDirection: "row", justifyContent: "space-between",
                  alignItems: "center", marginTop: 10,
                }}
              >
                <Text style={{ color: "#888", fontSize: 12 }}>{noteText.length}/280</Text>
                <Pressable
                  onPress={saveNote}
                  style={{
                    backgroundColor: "#9013BB", borderRadius: 10,
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

      <MoreOptionsSheet
        visible={moreVisible}
        onClose={() => setMoreVisible(false)}
        onMoveToBoard={() => {
          setMoreVisible(false);
          router.push({ pathname: "/(app)/move-board", params: { id: save.id } } as never);
        }}
        onDelete={() => { setMoreVisible(false); handleDelete(); }}
      />

      <Toast message={toast} />
    </View>
  );
}
