import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import { SaveCard } from "@/components/SaveCard";
import type { Save, SaveCategory, SourcePlatform } from "@/lib/database.types";
import { registerDeviceToken } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

// ---------------------------------------------------------------------------
// Filter data
// ---------------------------------------------------------------------------
const CATEGORY_FILTERS: { value: "all" | SaveCategory; label: string }[] = [
  { value: "all",         label: "All" },
  { value: "places",      label: "📍 Places" },
  { value: "recipes",     label: "🍳 Recipes" },
  { value: "fashion",     label: "👗 Fashion" },
  { value: "shopping",    label: "🛍️ Shopping" },
  { value: "watch_learn", label: "▶️ Watch" },
  { value: "inspo",       label: "✨ Inspo" },
  { value: "unsorted",    label: "🗂️ Unsorted" },
];

const PLATFORM_FILTERS: { value: "all" | SourcePlatform; label: string }[] = [
  { value: "all",       label: "All platforms" },
  { value: "youtube",   label: "▶ YouTube" },
  { value: "instagram", label: "📸 Instagram" },
  { value: "web",       label: "🌐 Web" },
  { value: "whatsapp",  label: "💬 WhatsApp" },
];

// ---------------------------------------------------------------------------
// Shared chip row — used for both filter bars
// ---------------------------------------------------------------------------
function ChipRow<T extends string>({
  chips,
  active,
  onChange,
}: {
  chips: { value: T; label: string }[];
  active: T;
  onChange: (v: T) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 24, paddingVertical: 6 }}
    >
      {chips.map((chip) => {
        const selected = chip.value === active;
        return (
          <Pressable
            key={chip.value}
            onPress={() => onChange(chip.value)}
            className={`rounded-full border px-3 py-1.5 ${
              selected ? "border-coral bg-coral" : "border-line bg-white"
            }`}
          >
            <Text className={`text-sm font-medium ${selected ? "text-white" : "text-ink"}`}>
              {chip.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
export default function Home() {
  const { profile, session, signOut } = useAuth();

  const [saves, setSaves] = useState<Save[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<"all" | SaveCategory>("all");
  const [platformFilter, setPlatformFilter] = useState<"all" | SourcePlatform>("all");
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

  // Realtime: patch individual cards as enrichment completes.
  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel(`saves:${session.user.id}`)
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

  // Apply both filters (AND logic).
  const filtered = saves.filter((s) => {
    if (categoryFilter !== "all" && s.category !== categoryFilter) return false;
    if (platformFilter !== "all" && s.source_platform !== platformFilter) return false;
    return true;
  });

  const hasActiveFilter = categoryFilter !== "all" || platformFilter !== "all";
  const firstName = profile?.name?.split(" ")[0];

  return (
    <View className="flex-1 bg-cream">
      {/* Header */}
      <View className="px-6 pt-14 pb-2">
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-extrabold text-ink">
            {firstName ? `Hey ${firstName} 👋` : "Your saves"}
          </Text>
          <Pressable onPress={signOut}>
            <Text className="text-sm text-muted">Sign out</Text>
          </Pressable>
        </View>
        {profile?.home_city ? (
          <Text className="mt-0.5 text-sm text-muted">{profile.home_city}</Text>
        ) : null}
      </View>

      {/* Category filter */}
      <ChipRow
        chips={CATEGORY_FILTERS}
        active={categoryFilter}
        onChange={setCategoryFilter}
      />

      {/* Platform filter */}
      <ChipRow
        chips={PLATFORM_FILTERS}
        active={platformFilter}
        onChange={setPlatformFilter}
      />

      {/* Divider */}
      <View className="mx-6 h-px bg-line" />

      {/* Library */}
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#FF6B4A" size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View className="flex-1 items-center justify-center px-10">
          <Text className="text-4xl">{hasActiveFilter ? "🔍" : "📭"}</Text>
          <Text className="mt-4 text-center text-base font-semibold text-ink">
            {hasActiveFilter ? "No matches" : "Nothing here yet"}
          </Text>
          <Text className="mt-2 text-center text-sm leading-5 text-muted">
            {hasActiveFilter
              ? "Try changing the filters above."
              : "Share a link or Instagram post into Resurface and it'll appear here."}
          </Text>
          {hasActiveFilter && (
            <Pressable
              className="mt-4"
              onPress={() => {
                setCategoryFilter("all");
                setPlatformFilter("all");
              }}
            >
              <Text className="text-sm font-semibold text-coral">Clear filters</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={{ padding: 16, gap: 12 }}
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
              <SaveCard save={item} />
            </View>
          )}
          ListFooterComponent={filtered.length % 2 !== 0 ? <View className="flex-1" /> : null}
        />
      )}
    </View>
  );
}
