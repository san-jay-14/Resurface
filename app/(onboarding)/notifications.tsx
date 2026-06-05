import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { OnboardingScaffold } from "@/components/OnboardingScaffold";
import {
  registerDeviceToken,
  requestNotificationPermission,
} from "@/lib/notifications";
import { useAuth } from "@/providers/AuthProvider";

const promises = [
  "“You saved a rooftop bar here 3 weeks ago. Still want to go?”",
  "“Long weekend coming up — you had 4 getaway spots saved.”",
  "“Your birthday's in a week. Remember these outfits?”",
];

export default function NotificationsStep() {
  const router = useRouter();
  const { session } = useAuth();
  const [working, setWorking] = useState(false);

  async function enable() {
    setWorking(true);
    try {
      const granted = await requestNotificationPermission();
      // Register the push token now if we can; harmless if permission was denied.
      if (granted && session) await registerDeviceToken(session.user.id);
    } finally {
      setWorking(false);
      router.push("/(onboarding)/share-guide");
    }
  }

  return (
    <OnboardingScaffold
      step={3}
      totalSteps={4}
      title="The whole point: good timing"
      subtitle="Resurface only pings you when a save actually matters — at most twice a week, never spammy. It should feel like a friend texting, not an app nagging."
      primaryLabel="Turn on notifications"
      primaryLoading={working}
      onPrimary={enable}
      skipLabel="Maybe later"
      onSkip={() => router.push("/(onboarding)/share-guide")}
    >
      <View className="gap-3">
        {promises.map((line) => (
          <View
            key={line}
            className="rounded-2xl border border-line bg-coral-soft px-4 py-3"
          >
            <Text className="text-[15px] leading-6 text-ink">{line}</Text>
          </View>
        ))}
      </View>
    </OnboardingScaffold>
  );
}
