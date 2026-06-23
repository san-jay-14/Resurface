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
  { emoji: "📍", text: "\"You saved a rooftop bar here 3 weeks ago. Still want to go?\"" },
  { emoji: "✈️", text: "\"Long weekend coming up — you had 4 getaway spots saved.\"" },
  { emoji: "🎂", text: "\"Your birthday's in a week. Remember these outfits?\"" },
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
      title="we only ping you when it actually matters."
      titleAccent="actually matters"
      subtitle="At most twice a week. No streak reminders. No random nudges. Just Dibs saying — hey, remember this?"
      primaryLabel="yes, remind me →"
      primaryLoading={working}
      onPrimary={enable}
      skipLabel="I'll miss out then"
      onSkip={() => router.push("/(onboarding)/share-guide")}
    >
      <View style={{ gap: 10 }}>
        {NUDGES.map((n) => (
          <View
            key={n.emoji}
            style={{
              flexDirection: "row", alignItems: "flex-start", gap: 12,
              backgroundColor: "#F5F5F5", borderRadius: 14,
              padding: 14, borderWidth: 1, borderColor: "#E5E5E5",
            }}
          >
            <Text style={{ fontSize: 20, marginTop: 1 }}>{n.emoji}</Text>
            <Text style={{ color: "#555555", fontSize: 14, lineHeight: 20, flex: 1 }}>
              {n.text}
            </Text>
          </View>
        ))}
      </View>
    </DarkOnboardingScaffold>
  );
}
