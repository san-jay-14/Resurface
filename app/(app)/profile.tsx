import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  CATEGORY_EMOJI,
  CATEGORY_LABEL,
  PinCard,
} from "@/components/SaveCard";
import { TabBar } from "@/components/TabBar";
import type { Save, SaveCategory, SourcePlatform } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W = (SCREEN_W - 16 * 2 - 10) / 2; // 2-col with 10px gap, 16 side padding
const COLLAGE_H = Math.round(CARD_W * 0.82);

const SAVE_CATEGORIES: SaveCategory[] = [
  "places", "recipes", "fashion", "shopping", "watch_learn", "inspo", "unsorted",
];

const PLATFORM_META: Record<SourcePlatform, { label: string; emoji: string; color: string }> = {
  instagram: { label: "Instagram", emoji: "📸", color: "#833AB4" },
  youtube:   { label: "YouTube",   emoji: "▶️",  color: "#FF0000" },
  web:       { label: "Web",       emoji: "🌐",  color: "#1565C0" },
  whatsapp:  { label: "WhatsApp",  emoji: "💬",  color: "#25D366" },
  tiktok:    { label: "TikTok",    emoji: "🎵",  color: "#010101" },
  pinterest: { label: "Pinterest", emoji: "📌",  color: "#E60023" },
  twitter:   { label: "X/Twitter", emoji: "🐦",  color: "#1DA1F2" },
  linkedin:  { label: "LinkedIn",  emoji: "💼",  color: "#0A66C2" },
  unsorted:  { label: "Unsorted",  emoji: "🗂️",  color: "#444" },
};

// ---------------------------------------------------------------------------
// Board collage thumbnail layout
// ---------------------------------------------------------------------------
function BoardCollage({ thumbnails }: { thumbnails: (string | null)[] }) {
  const [t0, t1, t2] = [...thumbnails, null, null, null];

  if (!t0) {
    return (
      <View
        style={{
          height: COLLAGE_H, borderRadius: 14, backgroundColor: "#1A1A1A",
        }}
      />
    );
  }

  if (!t1) {
    return (
      <View style={{ height: COLLAGE_H, borderRadius: 14, overflow: "hidden" }}>
        <Image source={{ uri: t0 }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
      </View>
    );
  }

  return (
    <View
      style={{
        height: COLLAGE_H, flexDirection: "row", borderRadius: 14,
        overflow: "hidden", gap: 2,
      }}
    >
      <View style={{ flex: 2 }}>
        <Image source={{ uri: t0 }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flex: 1, backgroundColor: "#1A1A1A" }}>
          <Image source={{ uri: t1 }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        </View>
        <View style={{ flex: 1, backgroundColor: "#2A2A2A" }}>
          {t2
            ? <Image source={{ uri: t2 }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
            : null
          }
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Board card (custom + platform)
// ---------------------------------------------------------------------------
interface BoardItem {
  id: string;
  title: string;
  subtitle: string;
  thumbnails: (string | null)[];
  onPress: () => void;
}

function BoardCard({ item }: { item: BoardItem }) {
  return (
    <Pressable onPress={item.onPress} style={{ width: CARD_W }}>
      <BoardCollage thumbnails={item.thumbnails} />
      <Text
        style={{ color: "#fff", fontSize: 13, fontWeight: "700", marginTop: 8 }}
        numberOfLines={1}
      >
        {item.title}
      </Text>
      <Text style={{ color: "#666", fontSize: 11, marginTop: 2 }}>{item.subtitle}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Create board modal (dark-themed)
// ---------------------------------------------------------------------------
function CreateBoardModal({
  visible,
  userId,
  onCreated,
  onClose,
}: {
  visible: boolean;
  userId: string;
  onCreated: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    const { error } = await supabase
      .from("collections")
      .insert({ user_id: userId, name: trimmed });
    setLoading(false);
    if (error) {
      Alert.alert(
        "Error",
        error.message.includes("unique")
          ? `A board called "${trimmed}" already exists.`
          : error.message,
      );
      return;
    }
    setName("");
    onCreated();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose} />
      <View
        style={{
          backgroundColor: "#111", borderTopLeftRadius: 24, borderTopRightRadius: 24,
          paddingHorizontal: 20, paddingTop: 20, paddingBottom: 44,
        }}
      >
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 16 }}>
          New board
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Goa trip, Diwali shopping…"
          placeholderTextColor="#555"
          maxLength={50}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={create}
          style={{
            backgroundColor: "#1A1A1A", borderRadius: 14, paddingHorizontal: 16,
            paddingVertical: 12, color: "#fff", fontSize: 14, marginBottom: 16,
          }}
        />
        <Pressable
          onPress={create}
          disabled={loading || !name.trim()}
          style={{
            backgroundColor: name.trim() ? "#FF6B4A" : "#222",
            borderRadius: 32, paddingVertical: 15, alignItems: "center",
          }}
        >
          {loading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={{ color: name.trim() ? "#fff" : "#555", fontSize: 15, fontWeight: "700" }}>
                Create board
              </Text>
          }
        </Pressable>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Profile screen
// ---------------------------------------------------------------------------
type ProfileTab = "favourites" | "boards" | "platform";

interface BoardData {
  id: string;
  name: string;
  count: number;
  thumbnails: (string | null)[];
}

interface PlatformData {
  platform: SourcePlatform;
  count: number;
  thumbnails: (string | null)[];
}

export default function ProfileScreen() {
  const { profile, session } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<ProfileTab>("favourites");
  const [allSaves, setAllSaves] = useState<Save[]>([]);
  const [customBoards, setCustomBoards] = useState<BoardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [createBoardVisible, setCreateBoardVisible] = useState(false);

  const loadData = useCallback(async () => {
    if (!session) return;
    setLoading(true);

    const [savesRes, colRes] = await Promise.all([
      supabase
        .from("saves")
        .select("*")
        .eq("user_id", session.user.id)
        .eq("archived", false)
        .order("created_at", { ascending: false }),
      supabase
        .from("collections")
        .select(`id, name, collection_saves(saves(thumbnail_url))`)
        .eq("user_id", session.user.id)
        .order("name"),
    ]);

    setAllSaves((savesRes.data as Save[]) ?? []);

    type RawCol = {
      id: string;
      name: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      collection_saves: { saves: { thumbnail_url: string | null } | null }[];
    };
    setCustomBoards(
      ((colRes.data ?? []) as unknown as RawCol[]).map((col) => ({
        id: col.id,
        name: col.name,
        count: col.collection_saves?.length ?? 0,
        thumbnails: (col.collection_saves ?? [])
          .slice(0, 3)
          .map((cs) => cs.saves?.thumbnail_url ?? null),
      })),
    );

    setLoading(false);
  }, [session]);

  useFocusEffect(useCallback(() => { void loadData(); }, [loadData]));

  // Derived data
  const favourites = allSaves.filter((s) => s.is_favorite);

  const platformMap = new Map<SourcePlatform, PlatformData>();
  for (const save of allSaves) {
    const p = save.source_platform;
    if (!platformMap.has(p)) {
      platformMap.set(p, { platform: p, count: 0, thumbnails: [] });
    }
    const entry = platformMap.get(p)!;
    entry.count++;
    if (entry.thumbnails.length < 3 && save.thumbnail_url) {
      entry.thumbnails.push(save.thumbnail_url);
    }
  }
  const platformBoards = Array.from(platformMap.values())
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count - a.count);

  // User display
  const meta = session?.user?.user_metadata ?? {};
  const displayName: string =
    profile?.name ??
    (meta.full_name as string | undefined) ??
    (meta.name as string | undefined) ??
    "You";
  const avatarUrl: string | null =
    (meta.avatar_url as string | undefined) ??
    (meta.picture as string | undefined) ??
    null;
  const initials = displayName
    .split(" ")
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");

  const handleSettingsPress = () => {
    router.push("/(app)/settings" as never);
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar style="light" />

      {/* ── Top bar: avatar | tabs | gear ── */}
      <View
        style={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 16,
          paddingBottom: 14,
          flexDirection: "row",
          alignItems: "center",
          gap: 20,
        }}
      >
        {/* Avatar */}
        <Pressable onPress={handleSettingsPress}>
          <View
            style={{
              width: 38, height: 38, borderRadius: 19, overflow: "hidden",
              backgroundColor: "#EEEDFE", alignItems: "center", justifyContent: "center",
            }}
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
            ) : (
              <Text style={{ color: "#1C1714", fontSize: 14, fontWeight: "700" }}>{initials}</Text>
            )}
          </View>
        </Pressable>

        {/* Tabs */}
        {(["favourites", "boards", "platform"] as ProfileTab[]).map((tab) => {
          const active = tab === activeTab;
          const label =
            tab === "favourites" ? "Favourites"
              : tab === "boards" ? "Boards"
                : "Platform";
          return (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={{ alignItems: "center", gap: 6 }}
            >
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: active ? "700" : "400",
                  color: active ? "#fff" : "#666",
                }}
              >
                {label}
              </Text>
              <View
                style={{
                  height: 2, width: "100%", borderRadius: 1,
                  backgroundColor: active ? "#fff" : "transparent",
                }}
              />
            </Pressable>
          );
        })}

        <View style={{ flex: 1 }} />
      </View>

      {/* ── Search bar + "+" ── */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingBottom: 14,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Pressable
          onPress={() => router.replace("/(app)/search" as never)}
          style={{
            flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
            backgroundColor: "#1A1A1A", borderRadius: 26,
            paddingHorizontal: 14, paddingVertical: 11,
          }}
        >
          <Ionicons name="search" size={16} color="#666" />
          <Text style={{ color: "#555", fontSize: 15 }}>Search your saves</Text>
        </Pressable>
        <Pressable
          onPress={() => setCreateBoardVisible(true)}
          style={{
            width: 44, height: 44, borderRadius: 22,
            backgroundColor: "#1A1A1A", alignItems: "center", justifyContent: "center",
          }}
          hitSlop={4}
        >
          <Ionicons name="add" size={24} color="#fff" />
        </Pressable>
      </View>

      {/* ── Content ── */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color="#FF6B4A" size="large" />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          {/* Wrapped teaser */}
          {activeTab === "favourites" && allSaves.length >= 15 && (
            <Pressable
              onPress={() => router.push("/(app)/wrapped/history" as never)}
              style={{
                marginHorizontal: 16, marginBottom: 16,
                backgroundColor: "#1A0A2E",
                borderRadius: 16, padding: 14,
                flexDirection: "row", alignItems: "center", gap: 12,
                borderWidth: 1, borderColor: "#3A1A5E",
              }}
            >
              <Text style={{ fontSize: 28 }}>🎁</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>Your Dibs Wrapped is ready</Text>
                <Text style={{ color: "#888", fontSize: 12, marginTop: 2 }}>See your saves personality card</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#555" />
            </Pressable>
          )}

          {/* FAVOURITES tab */}
          {activeTab === "favourites" && (
            favourites.length === 0 ? (
              <View style={{ alignItems: "center", paddingTop: 80, paddingHorizontal: 40 }}>
                <Text style={{ fontSize: 40 }}>♡</Text>
                <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600", textAlign: "center", marginTop: 16 }}>
                  No favourites yet
                </Text>
                <Text style={{ color: "#666", fontSize: 13, textAlign: "center", lineHeight: 18, marginTop: 8 }}>
                  Tap the heart on any save to add it here.
                </Text>
              </View>
            ) : (
              <View
                style={{ flexDirection: "row", gap: 8, paddingHorizontal: 8, paddingTop: 4 }}
              >
                <View style={{ flex: 1, gap: 8 }}>
                  {favourites.filter((_, i) => i % 2 === 0).map((save) => (
                    <PinCard
                      key={save.id}
                      save={save}
                      onPress={() =>
                        router.push({ pathname: "/(app)/save/[id]", params: { id: save.id } } as never)
                      }
                    />
                  ))}
                </View>
                <View style={{ flex: 1, gap: 8 }}>
                  {favourites.filter((_, i) => i % 2 !== 0).map((save) => (
                    <PinCard
                      key={save.id}
                      save={save}
                      onPress={() =>
                        router.push({ pathname: "/(app)/save/[id]", params: { id: save.id } } as never)
                      }
                    />
                  ))}
                </View>
              </View>
            )
          )}

          {/* BOARDS tab */}
          {activeTab === "boards" && (() => {
            const categoryBoards = SAVE_CATEGORIES.map((cat) => {
              const catSaves = allSaves.filter((s) => s.category === cat);
              return {
                id: cat,
                label: CATEGORY_LABEL[cat],
                emoji: CATEGORY_EMOJI[cat],
                count: catSaves.length,
                thumbnails: catSaves
                  .filter((s) => s.thumbnail_url)
                  .slice(0, 3)
                  .map((s) => s.thumbnail_url),
              };
            }).filter((c) => c.count > 0);

            return (
              <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
                {/* Categories section */}
                {categoryBoards.length > 0 && (
                  <>
                    <Text style={{ color: "#888", fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 12 }}>
                      Categories
                    </Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 28 }}>
                      {categoryBoards.map((cat) => (
                        <BoardCard
                          key={cat.id}
                          item={{
                            id: cat.id,
                            title: `${cat.emoji} ${cat.label}`,
                            subtitle: `${cat.count} ${cat.count === 1 ? "Save" : "Saves"}`,
                            thumbnails: cat.thumbnails as (string | null)[],
                            onPress: () =>
                              router.push({
                                pathname: "/(app)/board/category",
                                params: { category: cat.id },
                              } as never),
                          }}
                        />
                      ))}
                    </View>
                  </>
                )}

                {/* Custom boards section */}
                <Text style={{ color: "#888", fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 12 }}>
                  Your Boards
                </Text>
                {customBoards.length === 0 ? (
                  <View style={{ alignItems: "center", paddingTop: 32, paddingHorizontal: 24 }}>
                    <Text style={{ color: "#666", fontSize: 13, textAlign: "center", lineHeight: 18 }}>
                      Tap + to create your first board.
                    </Text>
                    <Pressable
                      onPress={() => setCreateBoardVisible(true)}
                      style={{ marginTop: 16, backgroundColor: "#FF6B4A", borderRadius: 24, paddingHorizontal: 24, paddingVertical: 11 }}
                    >
                      <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>Create board</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                    {customBoards.map((board) => (
                      <BoardCard
                        key={board.id}
                        item={{
                          id: board.id,
                          title: board.name,
                          subtitle: `${board.count} ${board.count === 1 ? "Save" : "Saves"}`,
                          thumbnails: board.thumbnails,
                          onPress: () =>
                            router.push({
                              pathname: "/(app)/board/[id]",
                              params: { id: board.id, name: board.name },
                            } as never),
                        }}
                      />
                    ))}
                  </View>
                )}
              </View>
            );
          })()}

          {/* PLATFORM tab */}
          {activeTab === "platform" && (
            platformBoards.length === 0 ? (
              <View style={{ alignItems: "center", paddingTop: 80, paddingHorizontal: 40 }}>
                <Text style={{ fontSize: 40 }}>🌐</Text>
                <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600", textAlign: "center", marginTop: 16 }}>
                  No saves yet
                </Text>
                <Text style={{ color: "#666", fontSize: 13, textAlign: "center", lineHeight: 18, marginTop: 8 }}>
                  Share something into Resurface and it'll appear here by platform.
                </Text>
              </View>
            ) : (
              <View
                style={{
                  flexDirection: "row", flexWrap: "wrap",
                  paddingHorizontal: 16, gap: 10, paddingTop: 4,
                }}
              >
                {platformBoards.map((pb) => {
                  const meta = PLATFORM_META[pb.platform] ?? PLATFORM_META.unsorted;
                  const thumbs: (string | null)[] = pb.thumbnails.length > 0
                    ? pb.thumbnails
                    : [null];
                  return (
                    <BoardCard
                      key={pb.platform}
                      item={{
                        id: pb.platform,
                        title: meta.label,
                        subtitle: `${pb.count} ${pb.count === 1 ? "Save" : "Saves"}`,
                        thumbnails: thumbs,
                        onPress: () =>
                          router.replace("/(app)/" as never),
                      }}
                    />
                  );
                })}
              </View>
            )
          )}
        </ScrollView>
      )}

      <CreateBoardModal
        visible={createBoardVisible}
        userId={session?.user.id ?? ""}
        onCreated={loadData}
        onClose={() => setCreateBoardVisible(false)}
      />

      <TabBar active="profile" variant="dark" />
    </View>
  );
}
