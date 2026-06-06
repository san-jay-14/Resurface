import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CATEGORY_LABEL, SaveCard } from "@/components/SaveCard";
import type { Save, SaveCategory } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

export default function CategoryBoard() {
  const { category } = useLocalSearchParams<{ category: SaveCategory }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const [saves, setSaves] = useState<Save[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!category || !session) return;
    const fetch = async () => {
      const { data } = await supabase
        .from("saves")
        .select("*")
        .eq("user_id", session.user.id)
        .eq("category", category)
        .eq("archived", false)
        .order("created_at", { ascending: false });
      setSaves((data as Save[]) ?? []);
      setLoading(false);
    };
    void fetch();
  }, [category, session]);

  const label = CATEGORY_LABEL[category as SaveCategory] ?? category;

  return (
    <View className="flex-1 bg-cream">
      <View style={{ paddingTop: insets.top + 12 }} className="px-5 pb-3 flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={{ fontSize: 20 }}>←</Text>
        </Pressable>
        <Text className="text-xl font-bold text-ink">{label}</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#FF6B4A" size="large" />
        </View>
      ) : saves.length === 0 ? (
        <View className="flex-1 items-center justify-center px-10">
          <Text className="mt-3 text-sm text-muted text-center">No saves in this category.</Text>
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
