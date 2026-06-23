import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import {
  Alert,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/providers/AuthProvider";

const SCREEN_W = Dimensions.get("window").width;

// ─── Quick tile (matches Swiggy's 4-column grid exactly) ─────────────────────
const TILE_W = (SCREEN_W - 32 - 18) / 4; // 32 = outer padding×2, 18 = 3 gaps×6

function QuickTile({ icon, label, onPress, comingSoon }: {
  icon: string; label: string; onPress: () => void; comingSoon?: boolean;
}) {
  const handlePress = comingSoon
    ? () => Alert.alert("Coming soon", "We're working on it — stay tuned!")
    : onPress;

  return (
    <Pressable onPress={handlePress}>
      {({ pressed }) => (
        <View style={{
          width: TILE_W,
          height: TILE_W + 4,
          backgroundColor: pressed ? "#FAF6FD" : "#FFFFFF",
          borderRadius: 18,
          borderWidth: 1,
          borderColor: "#EBEBEB",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          shadowColor: "#000",
          shadowOpacity: 0.07,
          shadowOffset: { width: 0, height: 2 },
          shadowRadius: 6,
          elevation: 2,
          opacity: comingSoon ? 0.65 : 1,
        }}>
          <Ionicons name={icon as never} size={26} color={comingSoon ? "#AAAAAA" : "#555555"} />
          <Text style={{
            fontSize: 11,
            color: comingSoon ? "#AAAAAA" : "#333333",
            fontWeight: "400",
            textAlign: "center",
            lineHeight: 15,
          }}>
            {label}
          </Text>
          {comingSoon && (
            <View style={{
              position: "absolute", top: 5, right: 5,
              backgroundColor: "#9013BB", borderRadius: 5,
              paddingHorizontal: 4, paddingVertical: 2,
            }}>
              <Text style={{ color: "#fff", fontSize: 7, fontWeight: "800", letterSpacing: 0.3 }}>
                SOON
              </Text>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

// ─── Menu row (horizontal layout, matches Swiggy style) ──────────────────────
function MenuRow({
  icon, label, onPress, danger, comingSoon,
}: { icon: string; label: string; onPress: () => void; danger?: boolean; comingSoon?: boolean }) {
  const handlePress = comingSoon
    ? () => Alert.alert("Coming soon", "We're working on it — stay tuned!")
    : onPress;

  return (
    <Pressable onPress={handlePress}>
      {({ pressed }) => (
        <View style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 15,
          backgroundColor: pressed ? "#FAFAFA" : "#FFFFFF",
          opacity: comingSoon ? 0.65 : 1,
        }}>
          <View style={{ width: 28, alignItems: "center" }}>
            <Ionicons name={icon as never} size={22} color={danger ? "#E53935" : "#555555"} />
          </View>
          <Text style={{
            flex: 1,
            marginLeft: 14,
            fontSize: 15,
            color: danger ? "#E53935" : "#1A1A1A",
            fontWeight: "400",
          }}>
            {label}
          </Text>
          {comingSoon ? (
            <View style={{
              backgroundColor: "#F0E8F7", borderRadius: 6,
              paddingHorizontal: 7, paddingVertical: 3,
            }}>
              <Text style={{ color: "#9013BB", fontSize: 10, fontWeight: "700" }}>Soon</Text>
            </View>
          ) : !danger && (
            <Ionicons name="chevron-forward" size={16} color="#CCCCCC" />
          )}
        </View>
      )}
    </Pressable>
  );
}

function RowDivider() {
  return <View style={{ height: 1, backgroundColor: "#F2F2F2", marginLeft: 58 }} />;
}

function MenuCard({ children }: { children: React.ReactNode }) {
  return (
    <View style={{
      marginHorizontal: 16,
      borderRadius: 16,
      backgroundColor: "#FFFFFF",
      overflow: "hidden",
      shadowColor: "#000",
      shadowOpacity: 0.05,
      shadowOffset: { width: 0, height: 1 },
      shadowRadius: 4,
      elevation: 1,
    }}>
      {children}
    </View>
  );
}

function SectionLabel({ title }: { title: string }) {
  return (
    <Text style={{
      fontSize: 12,
      fontWeight: "600",
      color: "#999999",
      letterSpacing: 0.6,
      paddingHorizontal: 20,
      paddingTop: 24,
      paddingBottom: 10,
    }}>
      {title}
    </Text>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────
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
    profile?.avatar_url ??
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
    <View style={{ flex: 1, backgroundColor: "#F2F2F7" }}>
      <StatusBar style="light" />

      {/* ── Hero header (Swiggy-style: name at bottom, watermark behind) ── */}
      <View style={{
        backgroundColor: "#9013BB",
        paddingTop: insets.top,
        height: insets.top + 220,
        overflow: "hidden",
        borderBottomLeftRadius: 28,
        borderBottomRightRadius: 28,
      }}>
        {/* Large watermark — top right */}
        <Text style={{
          position: "absolute",
          right: -30,
          top: insets.top - 20,
          fontSize: 200,
          fontWeight: "900",
          color: "rgba(255,255,255,0.09)",
          letterSpacing: -6,
          includeFontPadding: false,
        }}>
          dibs.
        </Text>

        {/* Back arrow row */}
        <View style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingTop: 12,
        }}>
          <Pressable onPress={() => router.back()} hitSlop={14}>
            <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* Name + email — pinned to bottom of header */}
        <View style={{
          position: "absolute",
          bottom: 24,
          left: 20,
          right: 20,
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
        }}>
          {/* Avatar */}
          <View style={{
            width: 60, height: 60, borderRadius: 30,
            backgroundColor: "rgba(255,255,255,0.18)",
            alignItems: "center", justifyContent: "center",
            borderWidth: 2, borderColor: "rgba(255,255,255,0.3)",
            overflow: "hidden",
          }}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
            ) : (
              <Text style={{ color: "#FFFFFF", fontSize: 22, fontWeight: "700" }}>{initials}</Text>
            )}
          </View>

          {/* Text */}
          <View style={{ flex: 1 }}>
            <Text style={{
              color: "#FFFFFF",
              fontSize: 26,
              fontWeight: "800",
              letterSpacing: -0.3,
            }}>
              {displayName}
            </Text>
            {email ? (
              <Text style={{
                color: "rgba(255,255,255,0.65)",
                fontSize: 13,
                marginTop: 3,
              }}>
                {email}
              </Text>
            ) : null}
          </View>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      >
        {/* ── Quick action tiles (Swiggy 4-column grid) ── */}
        <View style={{
          flexDirection: "row",
          gap: 6,
          paddingHorizontal: 16,
          paddingTop: 20,
          paddingBottom: 4,
        }}>
          <QuickTile
            icon="location-outline"
            label={"Home\nCity"}
            onPress={() => router.push("/(app)/location-picker?mode=home" as never)}
          />
          <QuickTile
            icon="flash-outline"
            label={"My\nRules"}
            onPress={() => router.push("/(app)/settings/rules" as never)}
            comingSoon
          />
          <QuickTile
            icon="sparkles-outline"
            label={"Clean\nUp"}
            onPress={() => router.push("/(app)/cleanup" as never)}
          />
          <QuickTile
            icon="gift-outline"
            label={"Wrapped"}
            onPress={() => router.push("/(app)/wrapped/history" as never)}
            comingSoon
          />
        </View>

        {/* ── Library ── */}
        <SectionLabel title="LIBRARY" />
        <MenuCard>
          <MenuRow
            icon="archive-outline"
            label="Archived Saves"
            onPress={() => router.push("/(app)/settings/archived" as never)}
          />
          <RowDivider />
          <MenuRow
            icon="sparkles-outline"
            label="Clean Up Library"
            onPress={() => router.push("/(app)/cleanup" as never)}
          />
          <RowDivider />
          <MenuRow
            icon="enter-outline"
            label="Join a Board"
            onPress={() => router.push("/(app)/boards/invite" as never)}
          />
        </MenuCard>

        {/* ── Account ── */}
        <SectionLabel title="ACCOUNT" />
        <MenuCard>
          <MenuRow
            icon="person-outline"
            label="Edit Profile"
            onPress={() => router.push("/(app)/settings/edit-profile" as never)}
          />
          <RowDivider />
          <MenuRow
            icon="notifications-outline"
            label="Notification Preferences"
            onPress={() => router.push("/(app)/settings/notifications" as never)}
          />
        </MenuCard>

        {/* ── Support ── */}
        <View style={{ height: 16 }} />
        <MenuCard>
          <MenuRow
            icon="bug-outline"
            label="Report a bug"
            onPress={() => router.push("/(app)/settings/report-bug" as never)}
          />
        </MenuCard>

        {/* ── Sign out ── */}
        <View style={{ height: 16 }} />
        <MenuCard>
          <MenuRow
            icon="log-out-outline"
            label="Sign out"
            onPress={handleSignOut}
            danger
          />
        </MenuCard>
      </ScrollView>
    </View>
  );
}
