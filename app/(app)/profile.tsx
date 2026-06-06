import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TabBar } from "@/components/TabBar";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

interface Stats {
  total: number;
  actedOn: number;
  boards: number;
}

function StatBox({ value, label }: { value: number; label: string }) {
  return (
    <View className="flex-1 bg-sand rounded-2xl p-3 items-center">
      <Text className="text-xl font-bold text-ink">{value}</Text>
      <Text className="text-xs text-muted mt-0.5">{label}</Text>
    </View>
  );
}

function SettingsRow({
  emoji,
  label,
  onPress,
}: {
  emoji: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-between py-4 border-b border-line"
    >
      <View className="flex-row items-center gap-3">
        <Text style={{ fontSize: 18 }}>{emoji}</Text>
        <Text className="text-sm text-ink">{label}</Text>
      </View>
      <Text className="text-muted text-base">›</Text>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const { profile, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    if (!profile) return;
    const fetchStats = async () => {
      const [totalRes, actedRes, boardsRes] = await Promise.all([
        supabase
          .from("saves")
          .select("*", { count: "exact", head: true })
          .eq("user_id", profile.id)
          .eq("archived", false),
        supabase
          .from("saves")
          .select("*", { count: "exact", head: true })
          .eq("user_id", profile.id)
          .eq("acted_on", true),
        supabase
          .from("collections")
          .select("*", { count: "exact", head: true })
          .eq("user_id", profile.id),
      ]);
      setStats({
        total: totalRes.count ?? 0,
        actedOn: actedRes.count ?? 0,
        boards: boardsRes.count ?? 0,
      });
      setLoadingStats(false);
    };
    void fetchStats();
  }, [profile]);

  const initials = (profile?.name ?? "?")
    .split(" ")
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");

  const actOnRate = stats && stats.total > 0
    ? Math.round((stats.actedOn / stats.total) * 100)
    : 0;

  return (
    <View className="flex-1 bg-cream">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Top bar */}
        <View style={{ paddingTop: insets.top + 12 }} className="px-5 pb-3">
          <Text className="text-xl font-bold text-ink">Profile</Text>
        </View>

        <View className="px-5">
          {/* Avatar + name */}
          <View className="flex-row items-center gap-4 mb-5">
            <View className="w-14 h-14 rounded-full items-center justify-center" style={{ backgroundColor: "#EEEDFE" }}>
              <Text className="text-lg font-semibold text-ink">{initials}</Text>
            </View>
            <View>
              <Text className="text-base font-semibold text-ink">{profile?.name ?? "You"}</Text>
              {profile?.home_city ? (
                <Text className="text-xs text-muted">{profile.home_city}</Text>
              ) : null}
            </View>
          </View>

          {/* Stats row */}
          {loadingStats ? (
            <ActivityIndicator color="#FF6B4A" size="small" className="mb-4" />
          ) : stats ? (
            <View className="flex-row gap-2 mb-3">
              <StatBox value={stats.total}   label="Saves" />
              <StatBox value={stats.actedOn} label="Acted on" />
              <StatBox value={stats.boards}  label="Boards" />
            </View>
          ) : null}

          {/* Act-on rate teaser */}
          {stats && stats.total > 0 ? (
            <View className="bg-sand rounded-2xl px-4 py-3 mb-5">
              <Text className="text-sm text-ink">
                You act on{" "}
                <Text className="font-semibold">{actOnRate}%</Text>
                {" "}of your saves. The rest are waiting.
              </Text>
            </View>
          ) : null}

          {/* Settings */}
          <SettingsRow emoji="🔔" label="Notifications" onPress={() => {}} />
          <SettingsRow emoji="🗂️" label="Categories & rules" onPress={() => {}} />
          <SettingsRow emoji="⚙️" label="Account" onPress={() => {}} />
          <Pressable
            onPress={signOut}
            className="flex-row items-center gap-3 py-4"
          >
            <Text style={{ fontSize: 18 }}>🚪</Text>
            <Text className="text-sm text-muted">Sign out</Text>
          </Pressable>
        </View>
      </ScrollView>

      <TabBar active="profile" />
    </View>
  );
}
