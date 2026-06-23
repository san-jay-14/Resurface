import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import * as Notifications from "expo-notifications";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { NotificationPrefs } from "@/lib/database.types";
import { requestNotificationPermission } from "@/lib/notifications";
import { updateProfile } from "@/lib/profile";
import { useAuth } from "@/providers/AuthProvider";

const DEFAULT_PREFS: NotificationPrefs = {
  new_city: true,
  birthday: true,
  long_weekend: true,
  frequency: "normal",
};

function SectionLabel({ title }: { title: string }) {
  return (
    <Text style={{
      fontSize: 12, fontWeight: "700", color: "#999",
      letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8,
    }}>
      {title}
    </Text>
  );
}

function ToggleRow({
  icon, label, subtitle, value, onChange,
}: { icon: string; label: string; subtitle: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{
      flexDirection: "row", alignItems: "center", gap: 14,
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: "#F0F0F0",
    }}>
      <View style={{
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: "#F0E8F7", alignItems: "center", justifyContent: "center",
      }}>
        <Ionicons name={icon as never} size={17} color="#9013BB" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, color: "#1A1A1A", fontWeight: "500" }}>{label}</Text>
        <Text style={{ fontSize: 12, color: "#888", marginTop: 2, lineHeight: 16 }}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: "#E5E5E5", true: "#D9B3EE" }}
        thumbColor={value ? "#9013BB" : "#FFFFFF"}
      />
    </View>
  );
}

function FrequencyOption({
  label, subtitle, active, onPress,
}: { label: string; subtitle: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row", alignItems: "center", gap: 14,
        paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: 1, borderBottomColor: "#F0F0F0",
        backgroundColor: active ? "#FAF6FD" : "#FFFFFF",
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, color: "#1A1A1A", fontWeight: active ? "700" : "500" }}>{label}</Text>
        <Text style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{subtitle}</Text>
      </View>
      <View style={{
        width: 22, height: 22, borderRadius: 11, borderWidth: 1.5,
        borderColor: active ? "#9013BB" : "#E5E5E5",
        backgroundColor: active ? "#9013BB" : "transparent",
        alignItems: "center", justifyContent: "center",
      }}>
        {active && <Ionicons name="checkmark" size={13} color="#fff" />}
      </View>
    </Pressable>
  );
}

export default function NotificationPreferencesScreen() {
  const { session, profile, refreshProfile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [permissionGranted, setPermissionGranted] = useState(false);
  const prefs = profile?.notification_prefs ?? DEFAULT_PREFS;

  useFocusEffect(
    useCallback(() => {
      void Notifications.getPermissionsAsync().then(({ status }) => setPermissionGranted(status === "granted"));
    }, []),
  );

  const patchPrefs = async (patch: Partial<NotificationPrefs>) => {
    if (!session) return;
    const next = { ...prefs, ...patch };
    await updateProfile(session.user.id, { notification_prefs: next });
    await refreshProfile();
  };

  const handleEnablePush = async () => {
    const granted = await requestNotificationPermission();
    setPermissionGranted(granted);
    if (!granted) {
      Alert.alert(
        "Notifications are off",
        "Enable them in your device Settings to get resurfaced saves.",
        [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => void Linking.openSettings() },
        ],
      );
    }
  };

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
          Notifications
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {!permissionGranted && (
          <Pressable
            onPress={handleEnablePush}
            style={{
              margin: 16, borderRadius: 16, backgroundColor: "#F0E8F7",
              borderWidth: 1, borderColor: "#E5BCEC", padding: 14,
              flexDirection: "row", alignItems: "center", gap: 12,
            }}
          >
            <Ionicons name="notifications-off-outline" size={22} color="#9013BB" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#3A0A57", fontSize: 13, fontWeight: "700" }}>
                Push notifications are off
              </Text>
              <Text style={{ color: "#888", fontSize: 12, marginTop: 2 }}>
                Tap to turn them on so Dibs can resurface your saves.
              </Text>
            </View>
          </Pressable>
        )}

        <SectionLabel title="RESURFACE ME WHEN…" />
        <ToggleRow
          icon="airplane-outline"
          label="I arrive somewhere new"
          subtitle="Get a nudge about saved places when you're away from home."
          value={prefs.new_city}
          onChange={(v) => void patchPrefs({ new_city: v })}
        />
        <ToggleRow
          icon="gift-outline"
          label="My birthday is coming up"
          subtitle="A reminder about saved gifts, outfits, or plans 8 days out."
          value={prefs.birthday}
          onChange={(v) => void patchPrefs({ birthday: v })}
        />
        <ToggleRow
          icon="sunny-outline"
          label="A long weekend is near"
          subtitle="Surface saved places 2–4 days before a long weekend."
          value={prefs.long_weekend}
          onChange={(v) => void patchPrefs({ long_weekend: v })}
        />

        <SectionLabel title="HOW OFTEN" />
        <FrequencyOption
          label="Normal"
          subtitle="Up to 2 nudges a week — our default pacing."
          active={prefs.frequency === "normal"}
          onPress={() => void patchPrefs({ frequency: "normal" })}
        />
        <FrequencyOption
          label="Minimal"
          subtitle="Only the most relevant moments — fewer, quieter nudges."
          active={prefs.frequency === "minimal"}
          onPress={() => void patchPrefs({ frequency: "minimal" })}
        />

        <Text style={{ color: "#AAA", fontSize: 11.5, paddingHorizontal: 16, paddingTop: 16, lineHeight: 16 }}>
          We only send notifications between 9am–9pm{Platform.OS === "ios" ? "" : " local time"}, and never more than what you've chosen above.
        </Text>
      </ScrollView>
    </View>
  );
}
