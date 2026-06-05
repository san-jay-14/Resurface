import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Text, View } from "react-native";

import { OnboardingScaffold } from "@/components/OnboardingScaffold";
import { updateProfile } from "@/lib/profile";
import { useAuth } from "@/providers/AuthProvider";

const steps = [
  {
    n: "1",
    text: "Find something worth keeping — a reel, a recipe, a place, a product.",
  },
  { n: "2", text: "Tap the share button, then pick Resurface from the sheet." },
  {
    n: "3",
    text: "One tap to categorise. That's it — I'll bring it back when it matters.",
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
      await refreshProfile(); // gate in _layout redirects to (app)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't finish setup.";
      Alert.alert("Hmm", message);
      setFinishing(false);
    }
  }

  return (
    <OnboardingScaffold
      step={4}
      totalSteps={4}
      title="Saving takes one tap"
      subtitle="Resurface lives behind the share button in every app. Nothing to copy-paste."
      primaryLabel="Start saving"
      primaryLoading={finishing}
      onPrimary={finish}
    >
      <View className="gap-4">
        {steps.map((s) => (
          <View key={s.n} className="flex-row items-start gap-4">
            <View className="h-9 w-9 items-center justify-center rounded-full bg-coral">
              <Text className="text-base font-bold text-white">{s.n}</Text>
            </View>
            <Text className="flex-1 text-base leading-6 text-ink">
              {s.text}
            </Text>
          </View>
        ))}
      </View>
    </OnboardingScaffold>
  );
}
