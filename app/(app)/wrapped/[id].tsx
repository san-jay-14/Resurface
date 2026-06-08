import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Share,
  Text,
  View,
} from "react-native";
import ViewShot, { type ViewShotRef } from "react-native-view-shot";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { WrappedCard } from "@/components/WrappedCard";
import type { WrappedHistory } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

export default function WrappedCardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const viewShotRef = useRef<ViewShotRef>(null);

  const [wrapped, setWrapped] = useState<WrappedHistory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      if (!id || !session) return;
      const { data } = await supabase
        .from("wrapped_history")
        .select("*")
        .eq("id", id)
        .eq("user_id", session.user.id)
        .single();
      setWrapped(data as WrappedHistory);
      setLoading(false);
    })();
  }, [id, session]);

  const handleShare = async () => {
    try {
      const uri = await viewShotRef.current?.capture();
      if (uri) {
        await Share.share({ url: uri, title: "My Dibs Wrapped" });
      }
    } catch {
      Alert.alert("Couldn't share", "Try again later.");
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
        <StatusBar style="light" />
        <ActivityIndicator color="#FF6B4A" size="large" />
      </View>
    );
  }

  if (!wrapped) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
        <StatusBar style="light" />
        <Text style={{ color: "#666", fontSize: 14 }}>Wrapped not found.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar style="light" />

      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 16,
          paddingBottom: 14,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </Pressable>
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", flex: 1, textAlign: "center" }}>
          Your Wrapped
        </Text>
        <View style={{ width: 26 }} />
      </View>

      {/* Period label */}
      <Text style={{ color: "#555", fontSize: 12, textAlign: "center", marginBottom: 20 }}>
        {new Date(wrapped.period_start).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
      </Text>

      {/* Card */}
      <View style={{ alignItems: "center", flex: 1, justifyContent: "center" }}>
        <ViewShot ref={viewShotRef} options={{ format: "jpg", quality: 0.95 }}>
          <WrappedCard
            copy={wrapped.copy}
            stats={wrapped.stats_snapshot}
            userId={session?.user.id ?? ""}
          />
        </ViewShot>
      </View>

      {/* Action buttons */}
      <View
        style={{
          paddingHorizontal: 20,
          paddingBottom: Math.max(insets.bottom, 20) + 16,
          paddingTop: 20,
          flexDirection: "row",
          gap: 12,
        }}
      >
        <Pressable
          onPress={handleShare}
          style={{
            flex: 1, backgroundColor: "#1A1A1A",
            borderRadius: 32, paddingVertical: 15, alignItems: "center",
            flexDirection: "row", justifyContent: "center", gap: 8,
          }}
        >
          <Ionicons name="download-outline" size={18} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>Download</Text>
        </Pressable>
        <Pressable
          onPress={handleShare}
          style={{
            flex: 1, backgroundColor: "#FF6B4A",
            borderRadius: 32, paddingVertical: 15, alignItems: "center",
            flexDirection: "row", justifyContent: "center", gap: 8,
          }}
        >
          <Ionicons name="share-outline" size={18} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>Share to Stories</Text>
        </Pressable>
      </View>
    </View>
  );
}
