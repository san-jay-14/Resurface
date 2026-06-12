import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ArchivedSave } from "@/lib/database.types";
import { CATEGORY_EMOJI, CATEGORY_LABEL } from "@/components/SaveCard";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

function daysUntilExpiry(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000));
}

function timeSince(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function ArchivedSavesScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [archives, setArchives] = useState<ArchivedSave[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchArchives = async () => {
    if (!session) return;
    const { data } = await supabase
      .from("archived_saves")
      .select("*")
      .eq("user_id", session.user.id)
      .order("archived_at", { ascending: false });
    setArchives((data as ArchivedSave[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { void fetchArchives(); }, [session]);

  const handleRestore = async (archive: ArchivedSave) => {
    const { error } = await supabase
      .from("saves")
      .update({ archived: false, archived_at: null })
      .eq("id", archive.original_save_id);

    if (error) {
      Alert.alert("Error", "Couldn't restore this save.");
      return;
    }
    await supabase.from("archived_saves").delete().eq("id", archive.id);
    setArchives((prev) => prev.filter((a) => a.id !== archive.id));
  };

  const handleDelete = (archive: ArchivedSave) => {
    Alert.alert(
      "Delete permanently?",
      "This save will be gone for good.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            await supabase.from("saves").delete().eq("id", archive.original_save_id);
            await supabase.from("archived_saves").delete().eq("id", archive.id);
            setArchives((prev) => prev.filter((a) => a.id !== archive.id));
          },
        },
      ],
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <StatusBar style="dark" />

      <View
        style={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 16,
          paddingBottom: 14,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginRight: 12 }}>
          <Ionicons name="chevron-back" size={26} color="#1A1A1A" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: "#1A1A1A", fontSize: 18, fontWeight: "700" }}>Archived Saves</Text>
          {archives.length > 0 && (
            <Text style={{ color: "#888", fontSize: 12, marginTop: 1 }}>
              Permanently deleted after 30 days
            </Text>
          )}
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color="#9013BB" size="large" />
        </View>
      ) : archives.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 }}>
          <Text style={{ fontSize: 36 }}>🗑</Text>
          <Text style={{ color: "#1A1A1A", fontSize: 16, fontWeight: "600", textAlign: "center", marginTop: 16 }}>
            Nothing archived
          </Text>
          <Text style={{ color: "#888", fontSize: 13, textAlign: "center", lineHeight: 18, marginTop: 8 }}>
            Saves you archive during Clean Up will appear here for 30 days.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        >
          {archives.map((archive) => {
            const save = archive.original_data;
            const emoji = CATEGORY_EMOJI[save.category] ?? "🗂️";
            const label = CATEGORY_LABEL[save.category] ?? "Unsorted";
            const daysLeft = daysUntilExpiry(archive.expires_at);
            const title = save.title ?? save.ai_description ?? "Saved item";

            return (
              <View
                key={archive.id}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 12,
                  paddingHorizontal: 16, paddingVertical: 14,
                  borderBottomWidth: 1, borderBottomColor: "#E5E5E5",
                }}
              >
                {/* Thumbnail */}
                <View style={{ width: 52, height: 52, borderRadius: 10, overflow: "hidden", backgroundColor: "#F5F5F5" }}>
                  {save.thumbnail_url ? (
                    <Image source={{ uri: save.thumbnail_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                  ) : (
                    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 22 }}>{emoji}</Text>
                    </View>
                  )}
                </View>

                {/* Info */}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#1A1A1A", fontSize: 13, fontWeight: "600" }} numberOfLines={1}>
                    {title}
                  </Text>
                  <Text style={{ color: "#888", fontSize: 11, marginTop: 2 }}>
                    {emoji} {label} · archived {timeSince(archive.archived_at)}
                  </Text>
                  <Text style={{ color: daysLeft <= 7 ? "#9013BB" : "#888", fontSize: 11, marginTop: 1 }}>
                    {daysLeft} {daysLeft === 1 ? "day" : "days"} left
                  </Text>
                </View>

                {/* Actions */}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    onPress={() => void handleRestore(archive)}
                    style={{ backgroundColor: "#F0E8F7", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 }}
                  >
                    <Text style={{ color: "#9013BB", fontSize: 12, fontWeight: "600" }}>Restore</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleDelete(archive)}
                    hitSlop={8}
                    style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#FFF0F0", alignItems: "center", justifyContent: "center" }}
                  >
                    <Ionicons name="trash-outline" size={15} color="#FF5050" />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
