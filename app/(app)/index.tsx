import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SaveCard } from "@/components/SaveCard";
import { TabBar } from "@/components/TabBar";
import type { Save, SaveCategory } from "@/lib/database.types";
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
// Filter + sort config
// ---------------------------------------------------------------------------
const CATEGORY_FILTERS: { value: "all" | "not_done" | SaveCategory; label: string }[] = [
  { value: "all",        label: "All" },
  { value: "not_done",   label: "Not done" },
  { value: "places",     label: "Places" },
  { value: "recipes",    label: "Recipes" },
  { value: "fashion",    label: "Fashion" },
  { value: "shopping",   label: "Shopping" },
  { value: "watch_learn",label: "Watch" },
  { value: "inspo",      label: "Inspo" },
];

type SortOption = "recent" | "oldest" | "not_done_first" | "fav_first";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "recent",        label: "Recent" },
  { value: "oldest",        label: "Oldest" },
  { value: "not_done_first",label: "Not done first" },
  { value: "fav_first",     label: "Favorites first" },
];

function applySortAndFilter(
  saves: Save[],
  filter: "all" | "not_done" | SaveCategory,
  sort: SortOption,
): Save[] {
  let result = [...saves];

  // Filter
  if (filter === "not_done") {
    result = result.filter((s) => !s.acted_on);
  } else if (filter !== "all") {
    result = result.filter((s) => s.category === filter);
  }

  // Sort
  switch (sort) {
    case "oldest":
      result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      break;
    case "not_done_first":
      result.sort((a, b) => {
        if (a.acted_on !== b.acted_on) return a.acted_on ? 1 : -1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      break;
    case "fav_first":
      result.sort((a, b) => {
        if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      break;
    default: // recent
      result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  return result;
}

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
      <Pressable className="flex-1 bg-black/40" onPress={onClose} />
      <View className="bg-white rounded-t-3xl px-6 pt-5 pb-10">
        <Text className="text-base font-semibold text-ink mb-4">Sort by</Text>
        {SORT_OPTIONS.map((opt) => (
          <Pressable
            key={opt.value}
            onPress={() => { onSelect(opt.value); onClose(); }}
            className="flex-row items-center justify-between py-3.5 border-b border-line"
          >
            <Text className="text-sm text-ink">{opt.label}</Text>
            {current === opt.value && (
              <Text className="text-coral text-base">✓</Text>
            )}
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
export default function Library() {
  const { session } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [saves, setSaves] = useState<Save[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "not_done" | SaveCategory>("all");
  const [sort, setSort] = useState<SortOption>("recent");
  const [sortVisible, setSortVisible] = useState(false);
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

  // Contextual location prompt: show after 3+ Places saves, once, if permission not granted.
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

  // Realtime: patch individual cards as enrichment or edits complete
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

  // Optimistic favorite toggle
  const handleFavorite = async (save: Save) => {
    const next = !save.is_favorite;
    setSaves((prev) => prev.map((s) => s.id === save.id ? { ...s, is_favorite: next } : s));
    const { error } = await supabase
      .from("saves")
      .update({ is_favorite: next, last_interacted_at: new Date().toISOString() })
      .eq("id", save.id);
    if (error) {
      // revert
      setSaves((prev) => prev.map((s) => s.id === save.id ? { ...s, is_favorite: !next } : s));
    }
  };

  const filtered = applySortAndFilter(saves, filter, sort);

  return (
    <View className="flex-1 bg-cream">
      {/* Top bar */}
      <View style={{ paddingTop: insets.top + 12 }} className="px-5 pb-3 flex-row items-center justify-between">
        <Text className="text-xl font-bold text-ink">Library</Text>
        <Pressable
          onPress={() => setSortVisible(true)}
          className="w-8 h-8 rounded-lg border border-line bg-white items-center justify-center"
        >
          <Text style={{ fontSize: 16 }}>⇅</Text>
        </Pressable>
      </View>

      {/* Tappable search bar */}
      <Pressable
        onPress={() => router.replace("/(app)/search" as never)}
        className="mx-5 mb-3 flex-row items-center gap-2 bg-sand rounded-xl px-3 py-2.5"
      >
        <Text className="text-muted" style={{ fontSize: 14 }}>🔍</Text>
        <Text className="text-muted text-sm">Search your saves</Text>
      </Pressable>

      {/* Contextual location permission prompt */}
      {showLocationPrompt && (
        <View className="mx-5 mb-3 rounded-2xl overflow-hidden" style={{ backgroundColor: "#E1F5EE" }}>
          <View className="px-4 py-3">
            <Text className="text-sm font-semibold text-ink mb-0.5">
              📍 Resurface you when you're there
            </Text>
            <Text className="text-xs text-muted leading-4">
              You've saved {saves.filter((s) => s.category === "places").length} places. Allow location so we can remind you when you're nearby.
            </Text>
            <View className="flex-row gap-2 mt-2.5">
              <Pressable
                onPress={async () => {
                  const granted = await requestLocationPermission();
                  setShowLocationPrompt(false);
                  await dismissLocationPrompt();
                  if (!granted) return;
                }}
                className="bg-ink rounded-lg px-4 py-1.5"
              >
                <Text className="text-white text-xs font-semibold">Turn on</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  setShowLocationPrompt(false);
                  await dismissLocationPrompt();
                }}
                className="px-4 py-1.5"
              >
                <Text className="text-xs text-muted">Not now</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 20,
          paddingTop: 2,
          paddingBottom: 12,
        }}
      >
        {CATEGORY_FILTERS.map((chip, i) => {
          const active = chip.value === filter;
          return (
            <Pressable
              key={chip.value}
              onPress={() => setFilter(chip.value)}
              style={{
                marginRight: i < CATEGORY_FILTERS.length - 1 ? 7 : 0,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 99,
                borderWidth: 1,
                borderColor: active ? "#1C1714" : "#E7DBCF",
                backgroundColor: active ? "#1C1714" : "#FFFFFF",
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: "500",
                  color: active ? "#FFFFFF" : "#8A7E74",
                }}
              >
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Content */}
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#FF6B4A" size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View className="flex-1 items-center justify-center px-10">
          <Text className="text-4xl">{filter !== "all" ? "🔍" : "📭"}</Text>
          <Text className="mt-4 text-center text-base font-semibold text-ink">
            {filter !== "all" ? "No matches" : "Nothing here yet"}
          </Text>
          <Text className="mt-2 text-center text-sm leading-5 text-muted">
            {filter !== "all"
              ? "Try a different filter."
              : "Share a link or Instagram post into Resurface and it'll appear here."}
          </Text>
          {filter !== "all" && (
            <Pressable className="mt-4" onPress={() => setFilter("all")}>
              <Text className="text-sm font-semibold text-coral">Clear filter</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 8 }}
          columnWrapperStyle={{ gap: 12 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void fetchSaves(true); }}
              tintColor="#FF6B4A"
            />
          }
          renderItem={({ item }) => (
            <View className="flex-1">
              <SaveCard
                save={item}
                onPress={() => router.push({ pathname: "/(app)/save/[id]", params: { id: item.id } } as never)}
                onFavorite={() => void handleFavorite(item)}
              />
            </View>
          )}
          ListFooterComponent={filtered.length % 2 !== 0 ? <View className="flex-1" /> : null}
        />
      )}

      <SortSheet
        visible={sortVisible}
        current={sort}
        onSelect={setSort}
        onClose={() => setSortVisible(false)}
      />

      <TabBar active="library" />
    </View>
  );
}
