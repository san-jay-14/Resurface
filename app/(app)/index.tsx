import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
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

import { useSavesFeed } from "@/hooks/useSavesFeed";
import { CategoryIcon, getSaveTitle, PinCard } from "@/components/SaveCard";
import { getActivityLastSeen } from "@/lib/activity";
import type { Save, SaveCategory } from "@/lib/database.types";
import {
  detectAndUpdateCity,
  dismissLocationPrompt,
  getLocationPermissionStatus,
  isLocationPromptDismissed,
  requestLocationPermission,
} from "@/lib/location";
import { registerDeviceToken } from "@/lib/notifications";
import { fetchPlacesMapSaves } from "@/lib/saves";
import { useAuth } from "@/providers/AuthProvider";

const CATEGORY_SHORTCUTS: { value: SaveCategory; label: string }[] = [
  { value: "places",      label: "Places" },
  { value: "fashion",     label: "Fashion" },
  { value: "recipes",     label: "Recipes" },
  { value: "shopping",    label: "Shopping" },
  { value: "watch_learn", label: "Watch" },
  { value: "inspo",       label: "Inspo" },
];

interface NearbySave extends Save {
  distanceKm: number;
  placeName: string | null;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function NearbyCard({ item, onPress }: { item: NearbySave; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width: 134 }}>
      <View style={{ borderRadius: 14, overflow: "hidden", backgroundColor: "#F5F5F5" }}>
        {item.thumbnail_url ? (
          <Image
            source={{ uri: item.thumbnail_url }}
            style={{ width: "100%", height: 100 }}
            resizeMode="cover"
          />
        ) : (
          <View style={{ width: "100%", height: 100, alignItems: "center", justifyContent: "center" }}>
            <CategoryIcon category="places" size={30} />
          </View>
        )}
      </View>
      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "600", color: "#1A1A1A", marginTop: 7 }}>
        {item.placeName ?? getSaveTitle(item)}
      </Text>
      <Text style={{ fontSize: 11, color: "#9013BB", marginTop: 2, fontWeight: "600" }}>
        {item.distanceKm < 1 ? "< 1 km away" : `${item.distanceKm.toFixed(1)} km away`}
      </Text>
    </Pressable>
  );
}

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
  const { session, profile, refreshProfile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { saves, loading, refreshing, refresh } = useSavesFeed(!!session);
  const [showLocationPrompt, setShowLocationPrompt] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);
  const [nearby, setNearby] = useState<NearbySave[]>([]);
  const [hasUnreadActivity, setHasUnreadActivity] = useState(false);

  // Re-check permission whenever the screen regains focus (covers the user
  // granting it from OS Settings and coming back, not just our own prompts).
  useFocusEffect(
    useCallback(() => {
      void getLocationPermissionStatus().then((status) => setLocationGranted(status === "granted"));
    }, []),
  );

  // Unread badge: compares the most recent save against when the user last
  // opened the Activity screen. Re-checked on new saves and on focus (the
  // latter catches the timestamp written when leaving the Activity screen).
  const refreshUnreadActivity = useCallback(async () => {
    const latestSaveAt = saves[0]?.created_at ?? null;
    if (!latestSaveAt) { setHasUnreadActivity(false); return; }
    const lastSeen = await getActivityLastSeen();
    setHasUnreadActivity(!lastSeen || new Date(latestSaveAt).getTime() > new Date(lastSeen).getTime());
  }, [saves]);

  useEffect(() => { void refreshUnreadActivity(); }, [refreshUnreadActivity]);
  useFocusEffect(useCallback(() => { void refreshUnreadActivity(); }, [refreshUnreadActivity]));

  async function enableLocation() {
    const granted = await requestLocationPermission();
    setLocationGranted(granted);
    if (granted && session) {
      await detectAndUpdateCity();
      await refreshProfile();
    }
  }

  useEffect(() => {
    if (session) void registerDeviceToken();
  }, [session]);

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

  // "Near you" — places saves within 30km of the device's last-detected position.
  useEffect(() => {
    const lat = profile?.current_city_lat;
    const lng = profile?.current_city_lng;
    const placeSaves = saves.filter((s) => s.category === "places");
    if (!lat || !lng || placeSaves.length === 0) { setNearby([]); return; }

    let cancelled = false;
    void (async () => {
      let mapped;
      try {
        ({ mapped } = await fetchPlacesMapSaves("places"));
      } catch {
        return; // "Near you" is optional; stay quiet when offline.
      }
      if (cancelled) return;
      const byId = new Map(placeSaves.map((p) => [p.id, p]));
      const withDistance = mapped
        .map((loc) => {
          const save = byId.get(loc.id);
          if (!save) return null;
          return {
            ...save,
            distanceKm: haversineKm(lat, lng, loc.lat, loc.lng),
            placeName: loc.location_name as string | null,
          };
        })
        .filter((x): x is NearbySave => x !== null && x.distanceKm <= 30)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 10);

      setNearby(withDistance);
    })();
    return () => { cancelled = true; };
  }, [saves, profile?.current_city_lat, profile?.current_city_lng]);

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
        {/* Row 1: brand logo + action icons */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Image
            source={require("@/assets/logo_black.png")}
            style={{ height: 48, width: 88 }}
            resizeMode="contain"
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
            <Pressable onPress={() => router.push("/(app)/search" as never)} hitSlop={10}>
              <Ionicons name="search-outline" size={24} color="#1A1A1A" />
            </Pressable>
            <Pressable
              onPress={() => router.push("/(app)/activity" as never)}
              hitSlop={10}
              style={{ position: "relative" }}
            >
              <Ionicons name="notifications-outline" size={24} color="#1A1A1A" />
              {hasUnreadActivity && (
                <View
                  style={{
                    position: "absolute", top: -1, right: -1,
                    width: 9, height: 9, borderRadius: 4.5,
                    backgroundColor: "#E03131", borderWidth: 1.5, borderColor: "#FFFFFF",
                  }}
                />
              )}
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
              onRefresh={refresh}
              tintColor="#9013BB"
            />
          }
        >
          {showLocationPrompt && (
            <View style={{ paddingHorizontal: 8, marginBottom: 4 }}>
              <LocationBanner
                count={placesCount}
                onEnable={async () => {
                  await enableLocation();
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

          {nearby.length > 0 ? (
            <View style={{ marginBottom: 22 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: "#1A1A1A", paddingHorizontal: 8, marginBottom: 12 }}>
                Near you
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 8, gap: 12 }}
              >
                {nearby.map((item) => (
                  <NearbyCard key={item.id} item={item} onPress={() => navigateToCard(item.id)} />
                ))}
              </ScrollView>
            </View>
          ) : !showLocationPrompt && placesCount > 0 && !locationGranted ? (
            <View
              style={{
                marginHorizontal: 8, marginBottom: 20, borderRadius: 16,
                backgroundColor: "#F0E8F7", borderWidth: 1, borderColor: "#E5BCEC",
                padding: 14,
              }}
            >
              <Text style={{ color: "#3A0A57", fontSize: 13, fontWeight: "700", marginBottom: 4 }}>
                📍 Near you
              </Text>
              <Text style={{ color: "#888", fontSize: 12, lineHeight: 17, marginBottom: 10 }}>
                Turn on location to see your saved places near where you are right now.
              </Text>
              <Pressable
                onPress={() => void enableLocation()}
                style={{
                  backgroundColor: "#9013BB", borderRadius: 8,
                  paddingHorizontal: 14, paddingVertical: 8, alignSelf: "flex-start",
                }}
              >
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>Enable location</Text>
              </Pressable>
            </View>
          ) : null}

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
