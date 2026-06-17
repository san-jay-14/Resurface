import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CategoryIcon, PinCard } from "@/components/SaveCard";
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

const CATEGORY_SHORTCUTS: { value: SaveCategory; label: string }[] = [
  { value: "places",      label: "Places" },
  { value: "fashion",     label: "Fashion" },
  { value: "recipes",     label: "Recipes" },
  { value: "shopping",    label: "Shopping" },
  { value: "watch_learn", label: "Watch" },
  { value: "inspo",       label: "Inspo" },
];

function MasonryGrid({ saves, onPressCard }: { saves: Save[]; onPressCard: (id: string) => void }) {
  const left  = saves.filter((_, i) => i % 2 === 0);
  const right = saves.filter((_, i) => i % 2 !== 0);
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <View style={{ flex: 1, gap: 8 }}>
        {left.map((s) => <PinCard key={s.id} save={s} onPress={() => onPressCard(s.id)} />)}
      </View>
      <View style={{ flex: 1, gap: 8 }}>
        {right.map((s) => <PinCard key={s.id} save={s} onPress={() => onPressCard(s.id)} />)}
      </View>
    </View>
  );
}

function LocationBanner({ count, onEnable, onDismiss }: {
  count: number; onEnable: () => void; onDismiss: () => void;
}) {
  return (
    <View style={{
      marginBottom: 16, borderRadius: 16,
      backgroundColor: "#F0E8F7", borderWidth: 1, borderColor: "#E5BCEC",
    }}>
      <View style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
        <Text style={{ color: "#3A0A57", fontSize: 13, fontWeight: "600", marginBottom: 2 }}>
          📍 Remind you when you're there
        </Text>
        <Text style={{ color: "#888", fontSize: 11, lineHeight: 15 }}>
          You've saved {count} places. Allow location so we can remind you when you're nearby.
        </Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <Pressable
            onPress={onEnable}
            style={{ backgroundColor: "#9013BB", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}
          >
            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>Turn on</Text>
          </Pressable>
          <Pressable onPress={onDismiss} style={{ paddingHorizontal: 10, paddingVertical: 7 }}>
            <Text style={{ color: "#666", fontSize: 12 }}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function Library() {
  const { session, profile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [saves, setSaves] = useState<Save[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showLocationPrompt, setShowLocationPrompt] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Unique suffix per mount prevents "cannot add callbacks after subscribe()" when
  // navigating back to this screen before the previous channel is fully removed.
  const channelId = useRef(`saves:lib:${Date.now()}`).current;

  useEffect(() => {
    if (session) void registerDeviceToken(session.user.id);
  }, [session]);

  const fetchSaves = async (quiet = false) => {
    if (!session) return;
    if (!quiet) setLoading(true);
    try {
      const { data, error } = await supabase
        .from("saves")
        .select("*")
        .eq("user_id", session.user.id)
        .eq("archived", false)
        .order("created_at", { ascending: false });
      if (error) console.warn("Failed to fetch saves:", error.message);
      else setSaves((data as Save[]) ?? []);
    } catch (err) {
      console.warn("fetchSaves threw:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void fetchSaves(); }, [session]);

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

  useEffect(() => {
    if (!session) return;

    // Remove stale channel before creating a new one
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(channelId)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "saves",
        filter: `user_id=eq.${session.user.id}`,
      }, (payload) => {
        if (payload.eventType === "INSERT") {
          setSaves((prev) => [payload.new as Save, ...prev]);
        } else if (payload.eventType === "UPDATE") {
          setSaves((prev) => prev.map((s) => s.id === (payload.new as Save).id ? payload.new as Save : s));
        } else if (payload.eventType === "DELETE") {
          setSaves((prev) => prev.filter((s) => s.id !== (payload.old as Save).id));
        }
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [session]);

  const placesCount = saves.filter((s) => s.category === "places").length;
  const navigateToCard = (id: string) =>
    router.push({ pathname: "/(app)/save/[id]", params: { id } } as never);

  const cityLabel = profile?.current_city ?? profile?.home_city ?? "Select city";

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <StatusBar style="dark" />

      {/* ── Top panel (BookMyShow-style) ── */}
      <View style={{
        paddingTop: insets.top + 12,
        paddingHorizontal: 20,
        paddingBottom: 16,
        backgroundColor: "#FFFFFF",
      }}>
        {/* Row 1: brand headline + action icons */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 26, fontWeight: "800", color: "#1A1A1A", letterSpacing: -0.5 }}>
            dibs.
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
            <Pressable onPress={() => router.push("/(app)/search" as never)} hitSlop={10}>
              <Ionicons name="search-outline" size={24} color="#1A1A1A" />
            </Pressable>
            <Pressable hitSlop={10}>
              <Ionicons name="notifications-outline" size={24} color="#1A1A1A" />
            </Pressable>
            <Pressable onPress={() => router.push("/(app)/profile" as never)} hitSlop={10}>
              <Ionicons name="person-circle-outline" size={26} color="#1A1A1A" />
            </Pressable>
          </View>
        </View>

        {/* Row 2: city picker */}
        <Pressable
          onPress={() => router.push("/(app)/location-picker?mode=current" as never)}
          style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}
          hitSlop={6}
        >
          <Ionicons name="location-sharp" size={13} color="#9013BB" />
          <Text style={{ fontSize: 14, color: "#9013BB", fontWeight: "600" }}>
            {cityLabel}
          </Text>
          <Ionicons name="chevron-down" size={13} color="#9013BB" />
        </Pressable>
      </View>

      {/* ── Category icon strip ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 18, paddingBottom: 16 }}
        style={{ flexGrow: 0 }}
      >
        {CATEGORY_SHORTCUTS.map((cat) => (
          <Pressable
            key={cat.value}
            onPress={() => router.push({
              pathname: "/(app)/board/category",
              params: { category: cat.value },
            } as never)}
            style={{ alignItems: "center", gap: 7, width: 60 }}
          >
            <View style={{
              width: 56, height: 56, borderRadius: 18,
              backgroundColor: "#F5F5F5",
              alignItems: "center", justifyContent: "center",
            }}>
              <CategoryIcon category={cat.value} size={26} />
            </View>
            <Text style={{ fontSize: 11, color: "#555", textAlign: "center", fontWeight: "500" }} numberOfLines={1}>
              {cat.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Divider */}
      <View style={{ height: 1, backgroundColor: "#F0F0F0" }} />

      {/* ── "For you" feed ── */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color="#9013BB" size="large" />
        </View>
      ) : saves.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 }}>
          <Text style={{ fontSize: 40 }}>📭</Text>
          <Text style={{ marginTop: 16, color: "#1A1A1A", fontSize: 16, fontWeight: "600", textAlign: "center" }}>
            Your board is empty
          </Text>
          <Text style={{ marginTop: 8, color: "#888", fontSize: 13, textAlign: "center", lineHeight: 18 }}>
            Share a link or Instagram post into Dibs.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 8, paddingTop: 16, paddingBottom: 20 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void fetchSaves(true); }}
              tintColor="#9013BB"
            />
          }
        >
          {showLocationPrompt && (
            <View style={{ paddingHorizontal: 8, marginBottom: 4 }}>
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
            </View>
          )}

          <View style={{ paddingHorizontal: 8, paddingBottom: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: "#1A1A1A" }}>Recently saved</Text>
            <Pressable onPress={() => router.push("/(app)/search" as never)} hitSlop={8}>
              <Text style={{ fontSize: 13, color: "#9013BB", fontWeight: "600" }}>See all</Text>
            </Pressable>
          </View>

          <MasonryGrid saves={saves} onPressCard={navigateToCard} />
        </ScrollView>
      )}

    </View>
  );
}
