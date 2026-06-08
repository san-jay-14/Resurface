import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/providers/AuthProvider";

interface RowProps {
  icon: string;
  label: string;
  onPress: () => void;
  value?: string;
  danger?: boolean;
}

function SettingsRow({ icon, label, onPress, value, danger }: RowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 14,
        paddingHorizontal: 16, paddingVertical: 15,
        backgroundColor: pressed ? "#111" : "transparent",
      })}
    >
      <View
        style={{
          width: 34, height: 34, borderRadius: 10,
          backgroundColor: danger ? "rgba(255,80,80,0.15)" : "#1A1A1A",
          alignItems: "center", justifyContent: "center",
        }}
      >
        <Ionicons name={icon as never} size={17} color={danger ? "#FF5050" : "#999"} />
      </View>
      <Text
        style={{
          flex: 1, fontSize: 15, color: danger ? "#FF5050" : "#fff",
        }}
      >
        {label}
      </Text>
      {value && <Text style={{ fontSize: 13, color: "#555" }}>{value}</Text>}
      {!danger && <Ionicons name="chevron-forward" size={15} color="#444" />}
    </Pressable>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text
      style={{
        color: "#555", fontSize: 11, fontWeight: "700",
        letterSpacing: 0.8, textTransform: "uppercase",
        paddingHorizontal: 16, paddingTop: 28, paddingBottom: 8,
      }}
    >
      {title}
    </Text>
  );
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: "#111", marginLeft: 64 }} />;
}

export default function SettingsScreen() {
  const { profile, session, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const meta = session?.user?.user_metadata ?? {};
  const displayName: string =
    profile?.name ??
    (meta.full_name as string | undefined) ??
    (meta.name as string | undefined) ??
    "You";
  const email = session?.user?.email ?? "";
  const avatarUrl: string | null =
    (meta.avatar_url as string | undefined) ??
    (meta.picture as string | undefined) ??
    null;
  const initials = displayName
    .split(" ")
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");

  const handleSignOut = () => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: signOut },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar style="light" />

      {/* ── Top bar ── */}
      <View
        style={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 16,
          paddingBottom: 14,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </Pressable>
        <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700", flex: 1 }}>
          Settings
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      >
        {/* ── Profile card ── */}
        <View
          style={{
            flexDirection: "row", alignItems: "center", gap: 14,
            paddingHorizontal: 16, paddingVertical: 18,
            marginHorizontal: 16, marginBottom: 4,
            backgroundColor: "#111", borderRadius: 16,
          }}
        >
          <View
            style={{
              width: 52, height: 52, borderRadius: 26, overflow: "hidden",
              backgroundColor: "#EEEDFE", alignItems: "center", justifyContent: "center",
            }}
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
            ) : (
              <Text style={{ color: "#1C1714", fontSize: 18, fontWeight: "700" }}>{initials}</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>{displayName}</Text>
            {email ? <Text style={{ color: "#666", fontSize: 13, marginTop: 2 }}>{email}</Text> : null}
          </View>
        </View>

        {/* ── Intelligence ── */}
        <SectionHeader title="Intelligence" />
        <View style={{ backgroundColor: "#0A0A0A", marginHorizontal: 0 }}>
          <SettingsRow
            icon="flash-outline"
            label="My Rules"
            onPress={() => router.push("/(app)/settings/rules" as never)}
          />
        </View>

        {/* ── Library ── */}
        <SectionHeader title="Library" />
        <View style={{ backgroundColor: "#0A0A0A" }}>
          <SettingsRow
            icon="trash-outline"
            label="Archived Saves"
            onPress={() => router.push("/(app)/settings/archived" as never)}
          />
          <Divider />
          <SettingsRow
            icon="sparkles-outline"
            label="Clean Up Library"
            onPress={() => router.push("/(app)/cleanup" as never)}
          />
        </View>

        {/* ── Wrapped ── */}
        <SectionHeader title="Your Dibs" />
        <View style={{ backgroundColor: "#0A0A0A" }}>
          <SettingsRow
            icon="gift-outline"
            label="Your Wrappeds"
            onPress={() => router.push("/(app)/wrapped/history" as never)}
          />
        </View>

        {/* ── Boards ── */}
        <SectionHeader title="Boards" />
        <View style={{ backgroundColor: "#0A0A0A" }}>
          <SettingsRow
            icon="enter-outline"
            label="Join a Board"
            onPress={() => router.push("/(app)/boards/invite" as never)}
          />
        </View>

        {/* ── Account ── */}
        <SectionHeader title="Account" />
        <View style={{ backgroundColor: "#0A0A0A" }}>
          <SettingsRow
            icon="log-out-outline"
            label="Sign out"
            onPress={handleSignOut}
            danger
          />
        </View>
      </ScrollView>
    </View>
  );
}
