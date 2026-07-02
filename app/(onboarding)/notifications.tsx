import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { DarkOnboardingScaffold } from "@/components/DarkOnboardingScaffold";
import {
  registerDeviceToken,
  requestNotificationPermission,
} from "@/lib/notifications";
import { useAuth } from "@/providers/AuthProvider";

const NUDGES = [
  {
    emoji: "📍",
    label: "Near you",
    text: "\"You saved a rooftop bar here 3 weeks ago. Still want to go?\"",
  },
  {
    emoji: "✈️",
    label: "Long weekend",
    text: "\"Long weekend coming up — you had 4 getaway spots saved.\"",
  },
  {
    emoji: "🎂",
    label: "Birthday",
    text: "\"Your birthday's in a week. Remember these outfits?\"",
  },
];

export default function NotificationsStep() {
  const router = useRouter();
  const { session } = useAuth();
  const [working, setWorking] = useState(false);

  async function enable() {
    setWorking(true);
    try {
      const granted = await requestNotificationPermission();
      if (granted && session) await registerDeviceToken(session.user.id);
    } finally {
      setWorking(false);
      router.push("/(onboarding)/share-guide");
    }
  }

  return (
    <DarkOnboardingScaffold
      step={3}
      totalSteps={4}
      title="let us remind you at the right time."
      titleAccent="right time"
      subtitle="Tap below to allow notifications — Dibs will ask your permission. At most twice a week, only when it's actually relevant."
      primaryLabel="Allow notifications →"
      primaryLoading={working}
      onPrimary={enable}
      skipLabel="skip for now"
      onSkip={() => router.push("/(onboarding)/share-guide")}
    >
      <View style={{ gap: 10 }}>
        <Text style={{ fontSize: 12, fontWeight: "700", color: "#888", letterSpacing: 0.6, marginBottom: 4 }}>
          WHEN WE'LL REACH OUT
        </Text>
        {NUDGES.map((n) => (
          <View
            key={n.emoji}
            style={{
              flexDirection: "row", alignItems: "flex-start", gap: 12,
              backgroundColor: "#F5F5F5", borderRadius: 14,
              padding: 14, borderWidth: 1, borderColor: "#E5E5E5",
            }}
          >
            <View style={{ alignItems: "center", gap: 2, paddingTop: 1 }}>
              <Text style={{ fontSize: 18 }}>{n.emoji}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <Ionicons name="notifications-outline" size={11} color="#9013BB" />
                <Text style={{ fontSize: 11, fontWeight: "700", color: "#9013BB", letterSpacing: 0.3 }}>
                  {n.label.toUpperCase()}
                </Text>
              </View>
              <Text style={{ color: "#555555", fontSize: 13, lineHeight: 19 }}>
                {n.text}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </DarkOnboardingScaffold>
  );
}
