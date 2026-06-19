import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CategoryIcon, CATEGORY_LABEL, getSaveTitle } from "@/components/SaveCard";
import { markActivitySeen } from "@/lib/activity";
import type { Save } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "yesterday" : `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

interface ActivityEntry {
  id: string;
  save: Save;
  actionLabel: string;
  timestamp: string;
}

type RawCollectionSave = {
  save_id: string;
  added_at: string;
  collections: { name: string } | null;
};

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------
function ActivityRow({ entry, onPress }: { entry: ActivityEntry; onPress: () => void }) {
  const { save, actionLabel, timestamp } = entry;
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row", alignItems: "center", gap: 12,
        paddingHorizontal: 16, paddingVertical: 12,
      }}
    >
      <View style={{ width: 48, height: 48, borderRadius: 12, overflow: "hidden", backgroundColor: "#F5F5F5" }}>
        {save.thumbnail_url ? (
          <Image source={{ uri: save.thumbnail_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <CategoryIcon category={save.category} size={22} />
          </View>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: "#1A1A1A", fontSize: 14, fontWeight: "600" }} numberOfLines={1}>
          {getSaveTitle(save)}
        </Text>
        <Text style={{ color: "#888", fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>
          {actionLabel}
        </Text>
      </View>
      <Text style={{ color: "#AAA", fontSize: 11.5 }}>{timeAgo(timestamp)}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
export default function ActivityLog() {
  const { session } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    void (async () => {
      setLoading(true);

      const { data: savesData } = await supabase
        .from("saves")
        .select("*")
        .eq("user_id", session.user.id)
        .eq("archived", false)
        .order("created_at", { ascending: false })
        .limit(150);

      const saves = (savesData as Save[]) ?? [];
      const savesById = new Map(saves.map((s) => [s.id, s]));

      const { data: collectionSavesData } = saves.length > 0
        ? await supabase
            .from("collection_saves")
            .select("save_id, added_at, collections(name)")
            .in("save_id", saves.map((s) => s.id))
        : { data: [] as RawCollectionSave[] };

      const saveEntries: ActivityEntry[] = saves.map((save) => ({
        id: `save:${save.id}`,
        save,
        actionLabel: `Saved to ${CATEGORY_LABEL[save.category] ?? "Unsorted"}`,
        timestamp: save.created_at,
      }));

      const boardEntries: ActivityEntry[] = ((collectionSavesData as unknown as RawCollectionSave[]) ?? [])
        .map((row) => {
          const save = savesById.get(row.save_id);
          if (!save || !row.collections) return null;
          return {
            id: `board:${row.save_id}:${row.added_at}`,
            save,
            actionLabel: `Added to "${row.collections.name}"`,
            timestamp: row.added_at,
          };
        })
        .filter((e): e is ActivityEntry => e !== null);

      const combined = [...saveEntries, ...boardEntries].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

      setEntries(combined);
      setLoading(false);
      void markActivitySeen();
    })();
  }, [session]);

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={{
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 12,
        flexDirection: "row", alignItems: "center", gap: 12,
        borderBottomWidth: 1, borderBottomColor: "#F0F0F0",
      }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color="#1A1A1A" />
        </Pressable>
        <Text style={{ fontSize: 17, fontWeight: "700", color: "#1A1A1A", flex: 1 }}>
          Activity
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color="#9013BB" size="large" />
        </View>
      ) : entries.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 }}>
          <Text style={{ fontSize: 36 }}>🗓️</Text>
          <Text style={{ marginTop: 14, color: "#1A1A1A", fontSize: 15, fontWeight: "600", textAlign: "center" }}>
            No activity yet
          </Text>
          <Text style={{ marginTop: 6, color: "#888", fontSize: 13, textAlign: "center", lineHeight: 18 }}>
            Every save and board you add it to will show up here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ paddingTop: 6, paddingBottom: insets.bottom + 24 }}
          renderItem={({ item }) => (
            <ActivityRow
              entry={item}
              onPress={() => router.push({ pathname: "/(app)/save/[id]", params: { id: item.save.id } } as never)}
            />
          )}
        />
      )}
    </View>
  );
}
