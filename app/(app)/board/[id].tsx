import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Component, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InviteSheet } from "@/components/InviteSheet";
import { PlacesMap } from "@/components/PlacesMap";
import { SaveListRow } from "@/components/SaveCard";
import type { Collection, CollectionMember, CollectionSaveReaction, PlaceSave, Save } from "@/lib/database.types";
import { shareCollection } from "@/lib/boardSharing";
import { fetchCollectionMapSaves } from "@/lib/saves";
import { appAlert } from "@/providers/AlertProvider";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

type SortOption = "recent" | "oldest";

// ---------------------------------------------------------------------------
// Map error boundary (Mapbox native module may not be built in this client)
// ---------------------------------------------------------------------------
class MapErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  render() {
    if (this.state.crashed) {
      return (
        <View style={{ height: 200, backgroundColor: "#F5F5F5", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#888", fontSize: 13 }}>Map unavailable</Text>
        </View>
      );
    }
    return this.props.children;
  }
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
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} onPress={onClose} />
      <View
        style={{
          backgroundColor: "#FFFFFF", borderTopLeftRadius: 24, borderTopRightRadius: 24,
          paddingHorizontal: 24, paddingTop: 20, paddingBottom: 44,
        }}
      >
        <Text style={{ color: "#1A1A1A", fontSize: 15, fontWeight: "700", marginBottom: 16 }}>Sort by</Text>
        {(["recent", "oldest"] as SortOption[]).map((opt) => (
          <Pressable
            key={opt}
            onPress={() => { onSelect(opt); onClose(); }}
            style={{
              flexDirection: "row", alignItems: "center", justifyContent: "space-between",
              paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#E5E5E5",
            }}
          >
            <Text style={{ color: "#1A1A1A", fontSize: 14 }}>
              {opt === "recent" ? "Most recent" : "Oldest first"}
            </Text>
            {current === opt && <Ionicons name="checkmark" size={18} color="#9013BB" />}
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Board detail screen
// ---------------------------------------------------------------------------
export default function BoardDetail() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const [saves, setSaves] = useState<Save[]>([]);
  const [board, setBoard] = useState<Collection | null>(null);
  const [members, setMembers] = useState<CollectionMember[]>([]);
  const [reactions, setReactions] = useState<CollectionSaveReaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<SortOption>("recent");
  const [sortVisible, setSortVisible] = useState(false);
  const [inviteVisible, setInviteVisible] = useState(false);
  const [mapSaves, setMapSaves] = useState<PlaceSave[]>([]);
  const [mapLoading, setMapLoading] = useState(false);

  const fetchAll = useCallback(async (quiet = false) => {
    if (!id || !session) return;
    if (!quiet) setLoading(true);

    const [savesRes, boardRes, membersRes, reactionsRes] = await Promise.all([
      supabase
        .from("collection_saves")
        .select("saves(*)")
        .eq("collection_id", id),
      supabase
        .from("collections")
        .select("*")
        .eq("id", id)
        .single(),
      supabase
        .from("collection_members")
        .select("*")
        .eq("collection_id", id),
      supabase
        .from("collection_save_reactions")
        .select("*")
        .eq("collection_id", id),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = ((savesRes.data ?? []) as any[])
      .map((r) => r.saves as Save)
      .filter(Boolean);
    items.sort((a, b) =>
      sort === "recent"
        ? new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        : new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    setSaves(items);
    setBoard(boardRes.data as Collection);
    setMembers((membersRes.data as CollectionMember[]) ?? []);
    setReactions((reactionsRes.data as CollectionSaveReaction[]) ?? []);
    setLoading(false);
    setRefreshing(false);
  }, [id, session, sort]);

  useFocusEffect(useCallback(() => { void fetchAll(); }, [fetchAll]));
  useEffect(() => { void fetchAll(); }, [sort]);

  // Location-marking boards get a map of their geo-tagged saves.
  useEffect(() => {
    if (!id || !board?.requires_location) { setMapSaves([]); return; }
    void (async () => {
      setMapLoading(true);
      const { mapped } = await fetchCollectionMapSaves(id);
      setMapSaves(mapped);
      setMapLoading(false);
    })();
  }, [id, board?.requires_location, saves.length]);

  const mapCenter = (() => {
    if (mapSaves.length === 0) return null;
    const lat = mapSaves.reduce((sum, s) => sum + s.lat, 0) / mapSaves.length;
    const lng = mapSaves.reduce((sum, s) => sum + s.lng, 0) / mapSaves.length;
    return { lat, lng };
  })();

  const handleFavorite = async (save: Save) => {
    const next = !save.is_favorite;
    setSaves((prev) => prev.map((s) => s.id === save.id ? { ...s, is_favorite: next } : s));
    const { error } = await supabase.from("saves").update({ is_favorite: next }).eq("id", save.id);
    if (error) setSaves((prev) => prev.map((s) => s.id === save.id ? { ...s, is_favorite: !next } : s));
  };

  const handleReaction = async (saveId: string, reaction: "in" | "pass") => {
    if (!session) return;
    const existing = reactions.find((r) => r.save_id === saveId && r.user_id === session.user.id);
    if (existing?.reaction === reaction) {
      setReactions((prev) => prev.filter((r) => r.id !== existing.id));
      await supabase.from("collection_save_reactions").delete().eq("id", existing.id);
    } else {
      const newReaction = { collection_id: id, save_id: saveId, user_id: session.user.id, reaction };
      const { data } = await supabase
        .from("collection_save_reactions")
        .upsert(newReaction, { onConflict: "collection_id,save_id,user_id" })
        .select()
        .single();
      if (existing) {
        setReactions((prev) => prev.map((r) => r.id === existing.id ? (data as CollectionSaveReaction) : r));
      } else {
        setReactions((prev) => [...prev, data as CollectionSaveReaction]);
      }

      // Check if all members reacted "in"
      const saveReactions = [...reactions.filter((r) => r.save_id === saveId && r.id !== existing?.id), data as CollectionSaveReaction];
      const inCount = saveReactions.filter((r) => r.reaction === "in").length;
      if (inCount >= members.length && members.length >= 2) {
        appAlert("Everyone's in! 🙌", "Time to make it happen?");
      }
    }
  };

  const generateInviteCode = async () => {
    if (!id || !session) return;
    const updated = await shareCollection(id, session.user.id);
    setBoard(updated);
    setInviteVisible(true);
  };

  const deleteBoard = () => {
    appAlert(
      "Delete board",
      `Delete "${name}"? Saves won't be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            await supabase.from("collections").delete().eq("id", id);
            router.back();
          },
        },
      ],
    );
  };

  const handleMoreOptions = () => {
    const isOwner = board?.owner_id === session?.user.id || !board?.owner_id;
    const options = [
      ...(board?.is_shared
        ? [{ text: "Show invite code", onPress: () => setInviteVisible(true) }]
        : [{ text: "Share board", onPress: () => void generateInviteCode() }]
      ),
      ...(isOwner
        ? [{ text: "Delete board", style: "destructive" as const, onPress: deleteBoard }]
        : [{ text: "Leave board", style: "destructive" as const, onPress: leaveBoard }]
      ),
      { text: "Cancel", style: "cancel" as const },
    ];
    appAlert(name ?? "Board", undefined, options);
  };

  const leaveBoard = async () => {
    if (!session) return;
    await supabase
      .from("collection_members")
      .delete()
      .eq("collection_id", id)
      .eq("user_id", session.user.id);
    router.back();
  };

  const isShared = board?.is_shared;

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <StatusBar style="dark" />

      {/* ── Top bar ── */}
      <View
        style={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 16,
          paddingBottom: 4,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color="#1A1A1A" />
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          {isShared && (
            <Pressable onPress={() => setInviteVisible(true)} hitSlop={8}>
              <Ionicons name="person-add-outline" size={20} color="#1A1A1A" />
            </Pressable>
          )}
          <Pressable onPress={handleMoreOptions} hitSlop={8}>
            <Ionicons name="ellipsis-horizontal" size={22} color="#1A1A1A" />
          </Pressable>
        </View>
      </View>

      {/* ── Board title + count ── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: "#1A1A1A", fontSize: 32, fontWeight: "800", letterSpacing: -0.5, flex: 1 }}>
            {name ?? "Board"}
          </Text>
          {isShared && (
            <View style={{ backgroundColor: "#E5BCEC", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ color: "#9013BB", fontSize: 11, fontWeight: "600" }}>Shared</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6, marginBottom: 4 }}>
          <Text style={{ color: "#888", fontSize: 13 }}>
            {saves.length} {saves.length === 1 ? "Save" : "Saves"}
          </Text>
          {members.length > 0 && (
            <Text style={{ color: "#888", fontSize: 12 }}>· {members.length + 1} members</Text>
          )}
        </View>
      </View>

      {/* ── Sub-tabs ── */}
      <View
        style={{
          flexDirection: "row", paddingHorizontal: 16, paddingBottom: 10,
          alignItems: "center", justifyContent: "space-between",
        }}
      >
        <View style={{ flexDirection: "row", gap: 24, alignItems: "center" }}>
          <Pressable style={{ alignItems: "center", gap: 5 }}>
            <Text style={{ color: "#888", fontSize: 15 }}>More ideas</Text>
            <View style={{ height: 2 }} />
          </Pressable>
          <Pressable style={{ alignItems: "center", gap: 5 }}>
            <Text style={{ color: "#1A1A1A", fontSize: 15, fontWeight: "700" }}>All saves</Text>
            <View style={{ height: 2, width: "100%", backgroundColor: "#9013BB", borderRadius: 1 }} />
          </Pressable>
        </View>
        <Pressable onPress={() => setSortVisible(true)} hitSlop={8}>
          <Ionicons name="options-outline" size={22} color="#1A1A1A" />
        </Pressable>
      </View>

      {/* ── Content ── */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color="#9013BB" size="large" />
        </View>
      ) : saves.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 }}>
          <Text style={{ fontSize: 36 }}>📋</Text>
          <Text style={{ color: "#1A1A1A", fontSize: 16, fontWeight: "600", textAlign: "center", marginTop: 16 }}>
            Board is empty
          </Text>
          <Text style={{ color: "#888", fontSize: 13, textAlign: "center", lineHeight: 18, marginTop: 8 }}>
            Open a save's detail view to add it here.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void fetchAll(true); }}
              tintColor="#9013BB"
            />
          }
        >
          {/* Location-marking boards get a map preview of their geo-tagged saves */}
          {board?.requires_location && (
            <View style={{ height: 200, marginHorizontal: 16, marginBottom: 16, borderRadius: 16, overflow: "hidden" }}>
              <MapErrorBoundary>
                <PlacesMap
                  saves={mapSaves}
                  unmappedCount={Math.max(0, saves.length - mapSaves.length)}
                  loading={mapLoading}
                  cityCenter={mapCenter}
                  onPinPress={() => {}}
                  onAddLocationPress={() => {}}
                />
              </MapErrorBoundary>
            </View>
          )}

          <View style={{ paddingHorizontal: 16 }}>
            {saves.map((save) => {
              const saveReactions = reactions.filter((r) => r.save_id === save.id);
              const inCount = saveReactions.filter((r) => r.reaction === "in").length;
              const myReaction = saveReactions.find((r) => r.user_id === session?.user.id);
              const allIn = isShared && inCount >= members.length + 1 && members.length >= 1;

              return (
                <View key={save.id}>
                  <SaveListRow
                    save={save}
                    onPress={() =>
                      router.push({ pathname: "/(app)/save/[id]", params: { id: save.id } } as never)
                    }
                    rightSlot={
                      <Pressable onPress={() => void handleFavorite(save)} hitSlop={8}>
                        <Ionicons
                          name={save.is_favorite ? "heart" : "heart-outline"}
                          size={18}
                          color={save.is_favorite ? "#D4537E" : "#C0C0C0"}
                        />
                      </Pressable>
                    }
                  />
                  {isShared && (
                    <View style={{ flexDirection: "row", gap: 6, paddingBottom: 10 }}>
                      <Pressable
                        onPress={() => void handleReaction(save.id, "in")}
                        style={{
                          flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                          gap: 4, backgroundColor: myReaction?.reaction === "in" ? "#22C55E22" : "#F5F5F5",
                          borderRadius: 20, paddingVertical: 6,
                          borderWidth: 1,
                          borderColor: myReaction?.reaction === "in" ? "#22C55E" : "transparent",
                        }}
                      >
                        <Text style={{ fontSize: 13 }}>{allIn ? "✅" : "👍"}</Text>
                        <Text style={{ color: "#888", fontSize: 11 }}>
                          {inCount > 0 ? `${inCount}` : "I'm in"}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void handleReaction(save.id, "pass")}
                        style={{
                          width: 36, alignItems: "center", justifyContent: "center",
                          backgroundColor: myReaction?.reaction === "pass" ? "#EF444422" : "#F5F5F5",
                          borderRadius: 20,
                          borderWidth: 1,
                          borderColor: myReaction?.reaction === "pass" ? "#EF4444" : "transparent",
                        }}
                      >
                        <Text style={{ fontSize: 13 }}>✕</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* ── Floating action bar ── */}
      <View
        style={{
          position: "absolute",
          bottom: Math.max(insets.bottom, 12) + 16,
          left: 28, right: 28,
          backgroundColor: "#1A1A1A",
          borderRadius: 40,
          flexDirection: "row",
          paddingVertical: 13, paddingHorizontal: 8,
          justifyContent: "space-around",
          alignItems: "center",
        }}
      >
        <Pressable
          onPress={() => setSortVisible(true)}
          style={{ alignItems: "center", gap: 4, paddingHorizontal: 14 }}
        >
          <Ionicons name="reorder-three-outline" size={22} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 11 }}>Organize</Text>
        </Pressable>

        <Pressable
          onPress={() => router.replace("/(app)/search" as never)}
          style={{ alignItems: "center", gap: 4, paddingHorizontal: 14 }}
        >
          <Ionicons name="add-circle-outline" size={22} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 11 }}>Add</Text>
        </Pressable>

        <Pressable
          onPress={() => isShared ? setInviteVisible(true) : void generateInviteCode()}
          style={{ alignItems: "center", gap: 4, paddingHorizontal: 14 }}
        >
          <Ionicons name={isShared ? "person-add-outline" : "share-outline"} size={22} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 11 }}>{isShared ? "Invite" : "Share"}</Text>
        </Pressable>
      </View>

      <SortSheet visible={sortVisible} current={sort} onSelect={setSort} onClose={() => setSortVisible(false)} />
      {board && (
        <InviteSheet visible={inviteVisible} board={board} onClose={() => setInviteVisible(false)} />
      )}

    </View>
  );
}
