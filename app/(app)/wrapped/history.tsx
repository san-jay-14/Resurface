import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { WrappedHistory } from "@/lib/database.types";
import { WrappedCard } from "@/components/WrappedCard";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { env } from "@/lib/env";

export default function WrappedHistoryScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [wrappeds, setWrappeds] = useState<WrappedHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase
      .from("wrapped_history")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });
    setWrappeds((data as WrappedHistory[]) ?? []);
    setLoading(false);
  }, [session]);

  useFocusEffect(useCallback(() => { void fetchHistory(); }, [fetchHistory]));

  const handleGenerate = async () => {
    if (!session) return;
    setGenerating(true);
    try {
      const res = await fetch(
        `${env.supabaseUrl}/functions/v1/generate-wrapped`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ user_id: session.user.id }),
        },
      );
      const json = await res.json() as { ok: boolean; error?: string };
      if (!json.ok) {
        Alert.alert("Couldn't generate", json.error ?? "Try again later.");
        return;
      }
      await fetchHistory();
    } catch {
      Alert.alert("Couldn't connect", "Try again later.");
    } finally {
      setGenerating(false);
    }
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
        <Text style={{ color: "#1A1A1A", fontSize: 18, fontWeight: "700", flex: 1 }}>Your Wrappeds</Text>
        <Pressable
          onPress={handleGenerate}
          disabled={generating}
          style={{
            backgroundColor: "#F5F5F5", borderRadius: 20,
            paddingHorizontal: 14, paddingVertical: 8,
            flexDirection: "row", alignItems: "center", gap: 6,
          }}
        >
          {generating
            ? <ActivityIndicator size="small" color="#9013BB" />
            : <>
                <Ionicons name="refresh-outline" size={14} color="#9013BB" />
                <Text style={{ color: "#9013BB", fontSize: 13, fontWeight: "600" }}>Generate</Text>
              </>
          }
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color="#9013BB" size="large" />
        </View>
      ) : wrappeds.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 }}>
          <Text style={{ fontSize: 36 }}>🎁</Text>
          <Text style={{ color: "#1A1A1A", fontSize: 16, fontWeight: "600", textAlign: "center", marginTop: 16 }}>
            No Wrappeds yet
          </Text>
          <Text style={{ color: "#888", fontSize: 13, textAlign: "center", lineHeight: 18, marginTop: 8 }}>
            Save 15+ things and tap Generate to see your first personality card.
          </Text>
          <Pressable
            onPress={handleGenerate}
            disabled={generating}
            style={{ marginTop: 20, backgroundColor: "#9013BB", borderRadius: 24, paddingHorizontal: 24, paddingVertical: 11 }}
          >
            {generating
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>Generate my Wrapped</Text>
            }
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 20 }}
        >
          {wrappeds.map((w) => (
            <Pressable
              key={w.id}
              onPress={() => router.push({ pathname: "/(app)/wrapped/[id]", params: { id: w.id } } as never)}
            >
              <WrappedCard copy={w.copy} stats={w.stats_snapshot} userId={session?.user.id ?? ""} />
              <Text style={{ color: "#888", fontSize: 12, textAlign: "center", marginTop: 8 }}>
                {new Date(w.period_start).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
                {" · "}tap to open
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
