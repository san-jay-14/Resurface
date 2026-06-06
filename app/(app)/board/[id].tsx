import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SaveCard } from "@/components/SaveCard";
import type { Save } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

export default function BoardDetail() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const [saves, setSaves] = useState<Save[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || !session) return;
    const fetch = async () => {
      const { data } = await supabase
        .from("collection_saves")
        .select("saves(*)")
        .eq("collection_id", id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items = (data ?? []).map((r: any) => r.saves as Save).filter(Boolean);
      items.sort((a: Save, b: Save) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setSaves(items as Save[]);
      setLoading(false);
    };
    void fetch();
  }, [id, session]);

  const deleteBoard = () => {
    Alert.alert(
      "Delete board",
      `Delete "${name}"? Saves in this board won't be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await supabase.from("collections").delete().eq("id", id);
            router.back();
          },
        },
      ],
    );
  };

  return (
    <View className="flex-1 bg-cream">
      <View style={{ paddingTop: insets.top + 12 }} className="px-5 pb-3 flex-row items-center justify-between">
        <View className="flex-row items-center gap-3">
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={{ fontSize: 20 }}>←</Text>
          </Pressable>
          <Text className="text-xl font-bold text-ink">{name}</Text>
        </View>
        <Pressable onPress={deleteBoard} hitSlop={12}>
          <Text className="text-sm text-muted">Delete</Text>
        </Pressable>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#FF6B4A" size="large" />
        </View>
      ) : saves.length === 0 ? (
        <View className="flex-1 items-center justify-center px-10">
          <Text className="text-3xl">📋</Text>
          <Text className="mt-3 text-base font-semibold text-ink text-center">Board is empty</Text>
          <Text className="mt-2 text-sm text-muted text-center">
            Open a save's detail view to add it to this board.
          </Text>
        </View>
      ) : (
        <FlatList
          data={saves}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          columnWrapperStyle={{ gap: 12 }}
          renderItem={({ item }) => (
            <View className="flex-1">
              <SaveCard
                save={item}
                onPress={() => router.push({ pathname: "/(app)/save/[id]", params: { id: item.id } } as never)}
              />
            </View>
          )}
          ListFooterComponent={saves.length % 2 !== 0 ? <View className="flex-1" /> : null}
        />
      )}
    </View>
  );
}
