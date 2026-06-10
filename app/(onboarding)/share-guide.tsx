import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Text, View } from "react-native";

import { DarkOnboardingScaffold } from "@/components/DarkOnboardingScaffold";
import { updateProfile } from "@/lib/profile";
import { useAuth } from "@/providers/AuthProvider";

const STEPS = [
  {
    n: "01",
    headline: "see something worth keeping",
    detail: "a reel, a restaurant, a product, a playlist — anything.",
  },
  {
    n: "02",
    headline: "hit the share button",
    detail: "tap Dibs in the share sheet. one tap.",
  },
  {
    n: "03",
    headline: "we'll bring it back",
    detail: "at the right time, in the right place. that's the whole deal.",
  },
];

export default function ShareGuideStep() {
  const router = useRouter();
  const { session, refreshProfile } = useAuth();
  const [finishing, setFinishing] = useState(false);

  async function finish() {
    if (!session) return;
    try {
      setFinishing(true);
      await updateProfile(session.user.id, { onboarding_completed: true });
      await refreshProfile();
    } catch (err) {
      Alert.alert("Hmm", err instanceof Error ? err.message : "Couldn't finish setup.");
      setFinishing(false);
    }
  }

  return (
    <DarkOnboardingScaffold
      step={4}
      totalSteps={4}
      title="saving takes one tap."
      titleAccent="one tap"
      subtitle="Dibs lives behind the share button in every app. No copy-pasting, no typing URLs."
      primaryLabel="call dibs →"
      primaryLoading={finishing}
      onPrimary={finish}
    >
      <View style={{ gap: 20 }}>
        {STEPS.map((s) => (
          <View key={s.n} style={{ flexDirection: "row", gap: 16, alignItems: "flex-start" }}>
            <Text style={{
              color: "#FF6B4A", fontSize: 11, fontWeight: "800",
              letterSpacing: 1, marginTop: 4, width: 22,
            }}>
              {s.n}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 3 }}>
                {s.headline}
              </Text>
              <Text style={{ color: "rgba(255,255,255,0.35)", fontSize: 14, lineHeight: 20 }}>
                {s.detail}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </DarkOnboardingScaffold>
  );
}
