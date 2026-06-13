import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Image,
  Modal,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  BoardDetailCard,
  CATEGORY_EMOJI,
  CATEGORY_LABEL,
  getSaveTitle,
} from "@/components/SaveCard";
import { PlacesMap } from "@/components/PlacesMap";
import type { PlaceSave, Save, SaveCategory, UserSubCategory } from "@/lib/database.types";
import { fetchPlacesMapSaves } from "@/lib/saves";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get("window");

// Bottom sheet snap positions (distance from top of screen)
const SNAP_HALF = SCREEN_H * 0.45;   // map visible above
const SNAP_FULL = 100;                // sheet almost full-screen

// ---------------------------------------------------------------------------
// Map error boundary
// ---------------------------------------------------------------------------
class MapErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  render() {
    if (this.state.crashed) {
      return (
        <View style={{ flex: 1, backgroundColor: "#F5F5F5", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#888", fontSize: 13 }}>Map unavailable</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Sub-category creation modal
// ---------------------------------------------------------------------------
const EMOJI_OPTIONS = ["📁", "⭐", "❤️", "🔥", "🌟", "💡", "🎯", "✈️", "🛍️", "🍽️", "🎬", "👗", "📍", "🏖️", "🏔️", "🌿"];

function CreateSubCategoryModal({
  visible, category, userId,
  onClose, onCreated,
}: {
  visible: boolean; category: SaveCategory; userId: string;
  onClose: () => void; onCreated: (sub: UserSubCategory) => void;
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("📁");
  const [loading, setLoading] = useState(false);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("user_sub_categories")
      .insert({ user_id: userId, category, name: trimmed, emoji })
      .select()
      .single();
    setLoading(false);
    if (error) { Alert.alert("Error", error.message); return; }
    setName("");
    setEmoji("📁");
    onCreated(data as UserSubCategory);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose} />
      <View style={{
        backgroundColor: "#FFFFFF", borderTopLeftRadius: 24, borderTopRightRadius: 24,
        paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40,
      }}>
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "#E5E5E5", alignSelf: "center", marginBottom: 20 }} />
        <Text style={{ fontSize: 16, fontWeight: "700", color: "#1A1A1A", marginBottom: 16 }}>
          New sub-category
        </Text>

        {/* Emoji picker */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
          {EMOJI_OPTIONS.map((e) => (
            <Pressable
              key={e}
              onPress={() => setEmoji(e)}
              style={{
                width: 44, height: 44, borderRadius: 12,
                backgroundColor: emoji === e ? "#F0E8F7" : "#F5F5F5",
                borderWidth: emoji === e ? 1.5 : 0, borderColor: "#9013BB",
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 22 }}>{e}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Goa Restaurants, Winter Outfits…"
          placeholderTextColor="#888"
          maxLength={40}
          autoFocus
          style={{
            backgroundColor: "#F5F5F5", borderRadius: 14,
            paddingHorizontal: 16, paddingVertical: 14,
            color: "#1A1A1A", fontSize: 15, marginBottom: 16,
          }}
        />

        <Pressable
          onPress={create}
          disabled={loading || !name.trim()}
          style={{
            backgroundColor: name.trim() ? "#9013BB" : "#F0F0F0",
            borderRadius: 32, paddingVertical: 15, alignItems: "center",
          }}
        >
          {loading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={{ color: name.trim() ? "#fff" : "#888", fontSize: 15, fontWeight: "700" }}>
                Create
              </Text>
          }
        </Pressable>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Save row (list item used inside the bottom sheet)
// ---------------------------------------------------------------------------
function SaveRow({ save, onPress }: { save: Save; onPress: () => void }) {
  const title = getSaveTitle(save);
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row", alignItems: "center", gap: 12,
        paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F5F5F5",
      }}
    >
      <View style={{ width: 52, height: 52, borderRadius: 10, overflow: "hidden", backgroundColor: "#F5F5F5" }}>
        {save.thumbnail_url
          ? <Image source={{ uri: save.thumbnail_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
          : <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 22 }}>{CATEGORY_EMOJI[save.category] ?? "🗂️"}</Text>
            </View>
        }
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: "500", color: "#1A1A1A" }} numberOfLines={1}>{title}</Text>
        <Text style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
          {save.acted_on ? "✓ Done" : CATEGORY_LABEL[save.category]}
          {save.is_favorite ? " · ★" : ""}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#C0C0C0" />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Main category screen
// ---------------------------------------------------------------------------
type FilterType = "all" | "favorites" | "done" | "undone";

export default function CategoryBoard() {
  const { category } = useLocalSearchParams<{ category: SaveCategory }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  // Data
  const [saves, setSaves] = useState<Save[]>([]);
  const [subCategories, setSubCategories] = useState<UserSubCategory[]>([]);
  const [mapSaves, setMapSaves] = useState<PlaceSave[]>([]);
  const [unmappedCount, setUnmappedCount] = useState(0);
  const [nearYouSaves, setNearYouSaves] = useState<Save[]>([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mapLoading, setMapLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [activeSubCat, setActiveSubCat] = useState<string | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  // Bottom sheet animation
  const sheetY = useRef(new Animated.Value(SNAP_HALF)).current;
  const lastY  = useRef(SNAP_HALF);
  const currentY = useRef(SNAP_HALF);

  // Keep currentY in sync with the animated value so onPanResponderGrant
  // can capture the real position even mid-animation.
  useEffect(() => {
    const id = sheetY.addListener(({ value }) => { currentY.current = value; });
    return () => sheetY.removeListener(id);
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dy) > 5 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        // Stop any running spring and capture the real position.
        sheetY.stopAnimation((value) => {
          lastY.current = value;
          currentY.current = value;
        });
      },
      onPanResponderMove: (_, g) => {
        // g.dy is cumulative from the start of THIS gesture — use lastY as base.
        const next = Math.max(SNAP_FULL, Math.min(SNAP_HALF + 60, lastY.current + g.dy));
        sheetY.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const releasePos = lastY.current + g.dy;
        const snapTo = (g.vy < -0.3 || releasePos < (SNAP_HALF + SNAP_FULL) / 2)
          ? SNAP_FULL
          : SNAP_HALF;
        lastY.current = snapTo;
        Animated.spring(sheetY, {
          toValue: snapTo,
          useNativeDriver: false,
          damping: 25,
          stiffness: 260,
        }).start();
      },
    }),
  ).current;

  const fetchSaves = useCallback(async (quiet = false) => {
    if (!category || !session) return;
    if (!quiet) setLoading(true);
    const { data } = await supabase
      .from("saves")
      .select("*")
      .eq("user_id", session.user.id)
      .eq("category", category)
      .eq("archived", false)
      .order("created_at", { ascending: false });
    setSaves((data as Save[]) ?? []);
    setLoading(false);
    setRefreshing(false);
  }, [category, session]);

  const fetchSubCategories = useCallback(async () => {
    if (!category || !session) return;
    const { data } = await supabase
      .from("user_sub_categories")
      .select("*")
      .eq("user_id", session.user.id)
      .eq("category", category)
      .order("created_at", { ascending: true });
    setSubCategories((data as UserSubCategory[]) ?? []);
  }, [category, session]);

  const MAPPED_CATEGORIES: SaveCategory[] = ["places", "fashion"];

  const fetchMapData = useCallback(async () => {
    if (!session || !MAPPED_CATEGORIES.includes(category as SaveCategory)) return;
    setMapLoading(true);
    const { mapped, unmappedCount: uc } = await fetchPlacesMapSaves(session.user.id, category as SaveCategory);
    setMapSaves(mapped);
    setUnmappedCount(uc);
    setMapLoading(false);
  }, [session, category]);

  const fetchNearYou = useCallback(async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      // For simplicity: show the 5 most recently-saved items as "near you" (a real impl would filter by lat/lng radius)
      setNearYouSaves(saves.slice(0, 5));
    } catch {
      // Location unavailable — skip Near you section
    }
  }, [saves]);

  useEffect(() => {
    void fetchSaves();
    void fetchSubCategories();
    if (category === "places" || category === "fashion") void fetchMapData();
  }, [fetchSaves, fetchSubCategories, fetchMapData]);

  useEffect(() => {
    if (saves.length > 0) void fetchNearYou();
  }, [saves]);

  // Filtered saves
  const displayedSaves = useMemo(() => {
    let result = saves;
    if (activeSubCat) result = result.filter((s) => s.sub_category_id === activeSubCat);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((s) =>
        getSaveTitle(s).toLowerCase().includes(q) ||
        (s.ai_description ?? "").toLowerCase().includes(q) ||
        (s.caption ?? "").toLowerCase().includes(q),
      );
    }
    if (activeFilter === "favorites") result = result.filter((s) => s.is_favorite);
    if (activeFilter === "done") result = result.filter((s) => s.acted_on);
    if (activeFilter === "undone") result = result.filter((s) => !s.acted_on);
    return result;
  }, [saves, activeSubCat, searchQuery, activeFilter]);

  const label = CATEGORY_LABEL[category as SaveCategory] ?? String(category);
  const emoji = CATEGORY_EMOJI[category as SaveCategory] ?? "🗂️";

  const FILTER_PILLS: { value: FilterType; label: string }[] = [
    { value: "all",       label: "All" },
    { value: "favorites", label: "★ Saved" },
    { value: "done",      label: "✓ Done" },
    { value: "undone",    label: "Pending" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: "#F5F5F5" }}>
      <StatusBar style="dark" />

      {/* ── Map layer (full screen, sits behind the sheet) ── */}
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
        {(category === "places" || category === "fashion") ? (
          <MapErrorBoundary>
            <PlacesMap
              saves={mapSaves}
              unmappedCount={unmappedCount}
              loading={mapLoading}
              onPinPress={() => {}}
              onAddLocationPress={() => {}}
            />
          </MapErrorBoundary>
        ) : (
          // Non-places: neutral gradient placeholder map feel
          <View style={{ flex: 1, backgroundColor: "#E8EEF4" }}>
            <View style={{ flex: 1, opacity: 0.6 }}>
              {/* Grid lines to simulate map */}
              {Array.from({ length: 8 }).map((_, i) => (
                <View key={i} style={{ height: 1, backgroundColor: "#C8D4DF", marginTop: SCREEN_H / 8 }} />
              ))}
            </View>
            {Array.from({ length: 6 }).map((_, i) => (
              <View key={i} style={{
                position: "absolute", top: 0, bottom: 0,
                left: (SCREEN_W / 6) * i, width: 1, backgroundColor: "#C8D4DF", opacity: 0.6,
              }} />
            ))}
            <View style={{
              position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
              alignItems: "center", justifyContent: "center",
            }}>
              <Text style={{ fontSize: 48, opacity: 0.25 }}>{emoji}</Text>
            </View>
          </View>
        )}
      </View>

      {/* ── Back button (floats above map) ── */}
      <View style={{
        position: "absolute", top: insets.top + 8, left: 16, zIndex: 20,
      }}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{
            width: 38, height: 38, borderRadius: 19,
            backgroundColor: "rgba(255,255,255,0.9)",
            alignItems: "center", justifyContent: "center",
            shadowColor: "#000", shadowOpacity: 0.1, shadowOffset: { width: 0, height: 2 }, shadowRadius: 4,
            elevation: 4,
          }}
        >
          <Ionicons name="chevron-back" size={22} color="#1A1A1A" />
        </Pressable>
      </View>

      {/* ── Swipeable bottom sheet ── */}
      <Animated.View
        style={{
          position: "absolute",
          top: sheetY,
          left: 0, right: 0,
          height: SCREEN_H,
          backgroundColor: "#FFFFFF",
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          shadowColor: "#000", shadowOpacity: 0.12,
          shadowOffset: { width: 0, height: -4 }, shadowRadius: 16,
          elevation: 20,
        }}
      >
        {/* Drag handle */}
        <View {...panResponder.panHandlers} style={{ paddingTop: 14, paddingBottom: 8, alignItems: "center" }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E5E5" }} />
        </View>

        {/* Sheet header: category title + count + view toggle */}
        <View style={{
          flexDirection: "row", alignItems: "center",
          paddingHorizontal: 16, paddingBottom: 12,
        }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 22, fontWeight: "800", color: "#1A1A1A", letterSpacing: -0.5 }}>
              {emoji} {label}
            </Text>
            <Text style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
              {saves.length} {saves.length === 1 ? "save" : "saves"}
            </Text>
          </View>
          <Pressable
            onPress={() => setViewMode((m) => m === "list" ? "grid" : "list")}
            style={{
              width: 36, height: 36, borderRadius: 10,
              backgroundColor: "#F5F5F5", alignItems: "center", justifyContent: "center",
            }}
          >
            <Ionicons name={viewMode === "list" ? "grid-outline" : "list-outline"} size={18} color="#1A1A1A" />
          </Pressable>
        </View>

        {/* Search bar */}
        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <View style={{
            flexDirection: "row", alignItems: "center", gap: 8,
            backgroundColor: "#F5F5F5", borderRadius: 12,
            paddingHorizontal: 12, paddingVertical: 10,
          }}>
            <Ionicons name="search-outline" size={16} color="#888" />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={`Search ${label.toLowerCase()}…`}
              placeholderTextColor="#888"
              style={{ flex: 1, fontSize: 14, color: "#1A1A1A" }}
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color="#888" />
              </Pressable>
            )}
          </View>
        </View>

        {/* Filter pills */}
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }}
          style={{ flexGrow: 0 }}
        >
          {FILTER_PILLS.map((pill) => {
            const active = activeFilter === pill.value;
            return (
              <Pressable
                key={pill.value}
                onPress={() => setActiveFilter(pill.value)}
                style={{
                  paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                  backgroundColor: active ? "#9013BB" : "#F5F5F5",
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: active ? "700" : "400", color: active ? "#fff" : "#888" }}>
                  {pill.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Scrollable content */}
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void fetchSaves(true); }}
              tintColor="#9013BB"
            />
          }
        >
          {/* Sub-categories grid */}
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#1A1A1A" }}>Sub-categories</Text>
              <Pressable onPress={() => setCreateVisible(true)} hitSlop={8}>
                <Text style={{ fontSize: 13, color: "#9013BB", fontWeight: "600" }}>+ New</Text>
              </Pressable>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {/* "All" pill */}
              <Pressable
                onPress={() => setActiveSubCat(null)}
                style={{
                  paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
                  backgroundColor: activeSubCat === null ? "#F0E8F7" : "#F5F5F5",
                  borderWidth: activeSubCat === null ? 1.5 : 0, borderColor: "#9013BB",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "700", color: activeSubCat === null ? "#9013BB" : "#888" }}>
                  All
                </Text>
              </Pressable>

              {subCategories.map((sub) => {
                const active = activeSubCat === sub.id;
                const count = saves.filter((s) => s.sub_category_id === sub.id).length;
                return (
                  <Pressable
                    key={sub.id}
                    onLongPress={() => {
                      Alert.alert(sub.name, "Delete this sub-category?", [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete", style: "destructive",
                          onPress: async () => {
                            await supabase.from("user_sub_categories").delete().eq("id", sub.id);
                            setSubCategories((prev) => prev.filter((s) => s.id !== sub.id));
                            if (activeSubCat === sub.id) setActiveSubCat(null);
                          },
                        },
                      ]);
                    }}
                    onPress={() => setActiveSubCat(active ? null : sub.id)}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
                      backgroundColor: active ? "#F0E8F7" : "#F5F5F5",
                      borderWidth: active ? 1.5 : 0, borderColor: "#9013BB",
                      flexDirection: "row", alignItems: "center", gap: 6,
                    }}
                  >
                    <Text style={{ fontSize: 14 }}>{sub.emoji}</Text>
                    <Text style={{ fontSize: 13, fontWeight: active ? "700" : "400", color: active ? "#9013BB" : "#888" }}>
                      {sub.name}
                    </Text>
                    {count > 0 && (
                      <View style={{
                        backgroundColor: active ? "#9013BB" : "#E5E5E5",
                        borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1,
                      }}>
                        <Text style={{ fontSize: 10, color: active ? "#fff" : "#888", fontWeight: "700" }}>
                          {count}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}

              {subCategories.length === 0 && (
                <Pressable
                  onPress={() => setCreateVisible(true)}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
                    backgroundColor: "#F5F5F5", borderWidth: 1, borderColor: "#E5E5E5",
                    borderStyle: "dashed",
                  }}
                >
                  <Text style={{ fontSize: 13, color: "#888" }}>Create your first…</Text>
                </Pressable>
              )}
            </ScrollView>
          </View>

          {/* Saves list / grid */}
          {loading ? (
            <View style={{ paddingVertical: 40, alignItems: "center" }}>
              <ActivityIndicator color="#9013BB" size="large" />
            </View>
          ) : displayedSaves.length === 0 ? (
            <View style={{ paddingVertical: 40, alignItems: "center", paddingHorizontal: 40 }}>
              <Text style={{ fontSize: 36 }}>{emoji}</Text>
              <Text style={{ color: "#1A1A1A", fontSize: 15, fontWeight: "600", textAlign: "center", marginTop: 14 }}>
                {searchQuery || activeSubCat || activeFilter !== "all"
                  ? "No saves match these filters"
                  : `No ${label.toLowerCase()} saves yet`}
              </Text>
              <Text style={{ color: "#888", fontSize: 13, textAlign: "center", lineHeight: 18, marginTop: 6 }}>
                Share content into Dibs and it'll be categorised here automatically.
              </Text>
            </View>
          ) : viewMode === "grid" ? (
            <View style={{ paddingHorizontal: 8 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1, gap: 8 }}>
                  {displayedSaves.filter((_, i) => i % 2 === 0).map((save) => (
                    <BoardDetailCard
                      key={save.id}
                      save={save}
                      onPress={() => router.push({ pathname: "/(app)/save/[id]", params: { id: save.id } } as never)}
                      onFavorite={async () => {
                        const next = !save.is_favorite;
                        setSaves((prev) => prev.map((s) => s.id === save.id ? { ...s, is_favorite: next } : s));
                        await supabase.from("saves").update({ is_favorite: next }).eq("id", save.id);
                      }}
                    />
                  ))}
                </View>
                <View style={{ flex: 1, gap: 8 }}>
                  {displayedSaves.filter((_, i) => i % 2 !== 0).map((save) => (
                    <BoardDetailCard
                      key={save.id}
                      save={save}
                      onPress={() => router.push({ pathname: "/(app)/save/[id]", params: { id: save.id } } as never)}
                      onFavorite={async () => {
                        const next = !save.is_favorite;
                        setSaves((prev) => prev.map((s) => s.id === save.id ? { ...s, is_favorite: next } : s));
                        await supabase.from("saves").update({ is_favorite: next }).eq("id", save.id);
                      }}
                    />
                  ))}
                </View>
              </View>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 16 }}>
              {displayedSaves.map((save) => (
                <SaveRow
                  key={save.id}
                  save={save}
                  onPress={() => router.push({ pathname: "/(app)/save/[id]", params: { id: save.id } } as never)}
                />
              ))}
            </View>
          )}

          {/* Near you section */}
          {nearYouSaves.length > 0 && (
            <View style={{ marginTop: 24 }}>
              <View style={{
                paddingHorizontal: 16, paddingBottom: 12,
                flexDirection: "row", alignItems: "center", justifyContent: "space-between",
              }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#1A1A1A" }}>
                  📍 Near you
                </Text>
                <Text style={{ fontSize: 12, color: "#888" }}>Based on your location</Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
              >
                {nearYouSaves.map((save) => (
                  <Pressable
                    key={save.id}
                    onPress={() => router.push({ pathname: "/(app)/save/[id]", params: { id: save.id } } as never)}
                    style={{ width: 130 }}
                  >
                    <View style={{
                      width: 130, height: 100, borderRadius: 14,
                      overflow: "hidden", backgroundColor: "#F5F5F5", marginBottom: 6,
                    }}>
                      {save.thumbnail_url
                        ? <Image source={{ uri: save.thumbnail_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                        : <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ fontSize: 30 }}>{emoji}</Text>
                          </View>
                      }
                    </View>
                    <Text style={{ fontSize: 12, fontWeight: "500", color: "#1A1A1A" }} numberOfLines={2}>
                      {getSaveTitle(save)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </ScrollView>
      </Animated.View>

      {/* Sub-category creation modal */}
      <CreateSubCategoryModal
        visible={createVisible}
        category={category as SaveCategory}
        userId={session?.user.id ?? ""}
        onClose={() => setCreateVisible(false)}
        onCreated={(sub) => setSubCategories((prev) => [...prev, sub])}
      />

    </View>
  );
}
