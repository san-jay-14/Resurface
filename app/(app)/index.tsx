import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Component, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PlaceDetailCard } from "@/components/PlaceDetailCard";
import { PlacesMap } from "@/components/PlacesMap";
import {
  CATEGORY_COLORS,
  CATEGORY_EMOJI,
  CATEGORY_LABEL,
  PinCard,
} from "@/components/SaveCard";
import { TabBar } from "@/components/TabBar";
import type { PlaceSave, Save, SaveCategory } from "@/lib/database.types";
import { fetchPlacesMapSaves } from "@/lib/saves";
import {
  dismissLocationPrompt,
  getLocationPermissionStatus,
  isLocationPromptDismissed,
  requestLocationPermission,
} from "@/lib/location";
import { registerDeviceToken } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

// ---------------------------------------------------------------------------
// Tab strip config
// ---------------------------------------------------------------------------
const TABS: { value: "all" | SaveCategory; label: string }[] = [
  { value: "all",        label: "For you" },
  { value: "places",     label: "Places" },
  { value: "recipes",    label: "Recipes" },
  { value: "fashion",    label: "Fashion" },
  { value: "shopping",   label: "Shopping" },
  { value: "watch_learn",label: "Watch" },
  { value: "inspo",      label: "Inspo" },
];

function applyFilter(saves: Save[], filter: "all" | SaveCategory): Save[] {
  if (filter === "all") return saves;
  return saves.filter((s) => s.category === filter);
}

// ---------------------------------------------------------------------------
// Masonry grid (used in both "For you" and board views)
// ---------------------------------------------------------------------------
function MasonryGrid({
  saves,
  onPressCard,
}: {
  saves: Save[];
  onPressCard: (id: string) => void;
}) {
  const leftItems = saves.filter((_, i) => i % 2 === 0);
  const rightItems = saves.filter((_, i) => i % 2 !== 0);
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <View style={{ flex: 1, gap: 8 }}>
        {leftItems.map((save) => (
          <PinCard key={save.id} save={save} onPress={() => onPressCard(save.id)} />
        ))}
      </View>
      <View style={{ flex: 1, gap: 8 }}>
        {rightItems.map((save) => (
          <PinCard key={save.id} save={save} onPress={() => onPressCard(save.id)} />
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Error boundary — catches Mapbox native-module crashes so the whole screen
// doesn't go down when the app is run without a native rebuild.
// ---------------------------------------------------------------------------
class MapErrorBoundary extends Component<
  { children: ReactNode },
  { crashed: boolean }
> {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  render() {
    if (this.state.crashed) {
      return (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: 40,
          }}
        >
          <Text
            style={{ color: "#666", textAlign: "center", fontSize: 13, lineHeight: 20 }}
          >
            Map requires a development build.{"\n"}
            Run: npx expo prebuild --clean
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Board view — shown when a category tab is active.
// For the Places tab, adds a grid/map toggle with lazy-loaded map data.
// ---------------------------------------------------------------------------
function BoardView({
  category,
  saves,
  onPressCard,
  refreshing,
  onRefresh,
}: {
  category: SaveCategory;
  saves: Save[];
  onPressCard: (id: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { session } = useAuth();

  const [viewMode, setViewMode] = useState<"grid" | "map">("grid");
  const [mapSaves, setMapSaves] = useState<PlaceSave[]>([]);
  const [unmappedCount, setUnmappedCount] = useState(0);
  const [mapLoading, setMapLoading] = useState(false);
  const [selectedSave, setSelectedSave] = useState<PlaceSave | null>(null);
  const mapFetchedRef = useRef(false);

  const fetchMapData = useCallback(async () => {
    if (!session || category !== "places" || mapFetchedRef.current) return;
    mapFetchedRef.current = true;
    setMapLoading(true);
    const { mapped, unmappedCount: uc } = await fetchPlacesMapSaves(session.user.id);
    setMapSaves(mapped);
    setUnmappedCount(uc);
    setMapLoading(false);
  }, [session, category]);

  useEffect(() => {
    if (viewMode === "map") void fetchMapData();
  }, [viewMode, fetchMapData]);

  async function handleMarkVisited(saveId: string) {
    // Optimistic update — flip pin colour immediately without waiting for DB.
    setMapSaves((prev) =>
      prev.map((s) => (s.id === saveId ? { ...s, acted_on: true } : s)),
    );
    setSelectedSave((prev) =>
      prev?.id === saveId ? { ...prev, acted_on: true } : prev,
    );
    await supabase
      .from("saves")
      .update({ acted_on: true, acted_on_at: new Date().toISOString() })
      .eq("id", saveId);
  }

  const colors = CATEGORY_COLORS[category];
  const emoji  = CATEGORY_EMOJI[category];
  const label  = CATEGORY_LABEL[category];
  const recentSaves = saves.slice(0, 6);

  // ── Map view ──────────────────────────────────────────────────────────────
  if (category === "places" && viewMode === "map") {
    return (
      <MapErrorBoundary>
        <View style={{ flex: 1 }}>
          <PlacesMap
            saves={mapSaves}
            unmappedCount={unmappedCount}
            loading={mapLoading}
            onPinPress={setSelectedSave}
            onAddLocationPress={() => {}}
          />
          {selectedSave && (
            <PlaceDetailCard
              save={selectedSave}
              onDismiss={() => setSelectedSave(null)}
              onMarkVisited={(id) => void handleMarkVisited(id)}
            />
          )}
        </View>
      </MapErrorBoundary>
    );
  }

  // ── Grid view ─────────────────────────────────────────────────────────────
  return (
    <ScrollView
      style={{ flex: 1 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6B4A" />
      }
    >
      {/* Category title + count + optional map toggle */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 18,
          paddingBottom: 4,
          flexDirection: "row",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <View>
          <Text
            style={{ color: "#fff", fontSize: 36, fontWeight: "800", letterSpacing: -1 }}
          >
            {label.toLowerCase()}
          </Text>
          <Text style={{ color: "#666", fontSize: 13, marginTop: 5 }}>
            {saves.length} {saves.length === 1 ? "Save" : "Saves"}
          </Text>
        </View>

        {category === "places" && (
          <Pressable
            onPress={() => setViewMode("map")}
            style={{
              backgroundColor: "#1A1A1A",
              borderRadius: 10,
              width: 38,
              height: 38,
              alignItems: "center",
              justifyContent: "center",
              marginTop: 6,
            }}
          >
            <Ionicons name="map-outline" size={18} color="#fff" />
          </Pressable>
        )}
      </View>

      {/* Recently saved section */}
      {recentSaves.length > 0 && (
        <>
          <View
            style={{
              paddingHorizontal: 16,
              paddingTop: 26,
              paddingBottom: 13,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>
              Recently saved by you
            </Text>
            <View
              style={{
                backgroundColor: "#2A2A2A",
                borderRadius: 10,
                width: 34,
                height: 34,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </View>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          >
            {recentSaves.map((save) => (
              <Pressable
                key={save.id}
                onPress={() => onPressCard(save.id)}
                style={{ borderRadius: 12, overflow: "hidden", width: 86, height: 86 }}
              >
                {save.thumbnail_url ? (
                  <Image
                    source={{ uri: save.thumbnail_url }}
                    style={{ width: "100%", height: "100%" }}
                    resizeMode="cover"
                  />
                ) : (
                  <View
                    style={{
                      flex: 1,
                      backgroundColor: colors.bg,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontSize: 26 }}>{emoji}</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}

      {/* Masonry grid */}
      {saves.length > 0 ? (
        <View style={{ paddingHorizontal: 8, paddingTop: 24, paddingBottom: 24 }}>
          <MasonryGrid saves={saves} onPressCard={onPressCard} />
        </View>
      ) : (
        <View style={{ alignItems: "center", paddingTop: 60, paddingHorizontal: 40 }}>
          <Text style={{ fontSize: 40 }}>📭</Text>
          <Text
            style={{
              color: "#fff", fontSize: 16, fontWeight: "600",
              textAlign: "center", marginTop: 16,
            }}
          >
            Nothing saved yet
          </Text>
          <Text
            style={{
              color: "#666", fontSize: 13, textAlign: "center",
              lineHeight: 18, marginTop: 8,
            }}
          >
            Save something in {label} and it'll appear here.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Contextual location banner (dark-themed)
// ---------------------------------------------------------------------------
function LocationBanner({
  count,
  onEnable,
  onDismiss,
}: {
  count: number;
  onEnable: () => void;
  onDismiss: () => void;
}) {
  return (
    <View
      style={{
        marginBottom: 12,
        borderRadius: 16,
        backgroundColor: "#1A1A1A",
        borderWidth: 1,
        borderColor: "#2A2A2A",
      }}
    >
      <View style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
        <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600", marginBottom: 2 }}>
          📍 Resurface you when you're there
        </Text>
        <Text style={{ color: "#888", fontSize: 11, lineHeight: 15 }}>
          You've saved {count} places. Allow location so we can remind you when you're nearby.
        </Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <Pressable
            onPress={onEnable}
            style={{
              backgroundColor: "#fff", borderRadius: 8,
              paddingHorizontal: 14, paddingVertical: 7,
            }}
          >
            <Text style={{ color: "#000", fontSize: 12, fontWeight: "700" }}>Turn on</Text>
          </Pressable>
          <Pressable onPress={onDismiss} style={{ paddingHorizontal: 10, paddingVertical: 7 }}>
            <Text style={{ color: "#666", fontSize: 12 }}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Home / Library screen
// ---------------------------------------------------------------------------
export default function Library() {
  const { session } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [saves, setSaves] = useState<Save[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | SaveCategory>("all");
  const [showLocationPrompt, setShowLocationPrompt] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (session) void registerDeviceToken(session.user.id);
  }, [session]);

  const fetchSaves = async (quiet = false) => {
    if (!session) return;
    if (!quiet) setLoading(true);
    const { data, error } = await supabase
      .from("saves")
      .select("*")
      .eq("user_id", session.user.id)
      .eq("archived", false)
      .order("created_at", { ascending: false });
    if (error) console.warn("Failed to fetch saves:", error.message);
    else setSaves((data as Save[]) ?? []);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { void fetchSaves(); }, [session]);

  // Contextual location prompt after 3+ Places saves
  useEffect(() => {
    const placesCount = saves.filter((s) => s.category === "places").length;
    if (placesCount < 3) return;
    void (async () => {
      const [status, dismissed] = await Promise.all([
        getLocationPermissionStatus(),
        isLocationPromptDismissed(),
      ]);
      if (status !== "granted" && !dismissed) setShowLocationPrompt(true);
    })();
  }, [saves]);

  // Realtime saves patch
  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel(`saves:lib:${session.user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "saves", filter: `user_id=eq.${session.user.id}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setSaves((prev) => [payload.new as Save, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setSaves((prev) =>
              prev.map((s) => s.id === (payload.new as Save).id ? (payload.new as Save) : s),
            );
          } else if (payload.eventType === "DELETE") {
            setSaves((prev) => prev.filter((s) => s.id !== (payload.old as Save).id));
          }
        },
      )
      .subscribe();
    channelRef.current = channel;
    return () => { void supabase.removeChannel(channel); };
  }, [session]);

  const filtered = applyFilter(saves, filter);
  const placesCount = saves.filter((s) => s.category === "places").length;

  const navigateToCard = (id: string) =>
    router.push({ pathname: "/(app)/save/[id]", params: { id } } as never);

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar style="light" />

      {/* Scrollable tab strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{
          paddingTop: insets.top + 10,
          paddingBottom: 12,
          paddingHorizontal: 16,
          gap: 28,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        {TABS.map((tab) => {
          const active = tab.value === filter;
          return (
            <Pressable
              key={tab.value}
              onPress={() => setFilter(tab.value)}
              style={{ alignItems: "center", gap: 6 }}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: active ? "700" : "400",
                  color: active ? "#FFFFFF" : "#666666",
                }}
              >
                {tab.label}
              </Text>
              <View
                style={{
                  height: 2,
                  width: "100%",
                  borderRadius: 1,
                  backgroundColor: active ? "#FFFFFF" : "transparent",
                }}
              />
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Content */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color="#FF6B4A" size="large" />
        </View>
      ) : filter !== "all" ? (
        // Board view for category tabs
        <BoardView
          category={filter}
          saves={filtered}
          onPressCard={navigateToCard}
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); void fetchSaves(true); }}
        />
      ) : filtered.length === 0 ? (
        // "For you" empty state
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 }}>
          <Text style={{ fontSize: 40 }}>📭</Text>
          <Text
            style={{
              marginTop: 16, color: "#fff", fontSize: 16,
              fontWeight: "600", textAlign: "center",
            }}
          >
            Your board is empty
          </Text>
          <Text
            style={{
              marginTop: 8, color: "#666", fontSize: 13,
              textAlign: "center", lineHeight: 18,
            }}
          >
            Share a link or Instagram post into Resurface.
          </Text>
        </View>
      ) : (
        // "For you" masonry feed
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 8, paddingTop: 4, paddingBottom: 20 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void fetchSaves(true); }}
              tintColor="#FF6B4A"
            />
          }
        >
          {showLocationPrompt && (
            <LocationBanner
              count={placesCount}
              onEnable={async () => {
                await requestLocationPermission();
                setShowLocationPrompt(false);
                await dismissLocationPrompt();
              }}
              onDismiss={async () => {
                setShowLocationPrompt(false);
                await dismissLocationPrompt();
              }}
            />
          )}
          <MasonryGrid saves={filtered} onPressCard={navigateToCard} />
        </ScrollView>
      )}

      <TabBar active="library" variant="dark" />
    </View>
  );
}
