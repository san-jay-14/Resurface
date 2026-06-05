import { useEffect } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { registerDeviceToken } from "@/lib/notifications";
import { useAuth } from "@/providers/AuthProvider";

export default function Home() {
  const { profile, session, signOut } = useAuth();

  // Spec §6.6: ensure the push token is registered on launch. Best-effort —
  // no-ops if notification permission was never granted or on an emulator.
  useEffect(() => {
    if (session) void registerDeviceToken(session.user.id);
  }, [session]);

  const firstName = profile?.name?.split(" ")[0];

  return (
    <Screen className="justify-between py-6">
      <View className="mt-10">
        <Text className="text-4xl font-extrabold text-ink">
          {firstName ? `Hey ${firstName}` : "You're all set"} 👋
        </Text>
        <Text className="mt-3 text-base leading-6 text-muted">
          {profile?.is_guest
            ? "You're saving as a guest. Sign in later to keep everything safe."
            : "Share something into Resurface and I'll bring it back at the right moment."}
        </Text>

        {/* Placeholder for the real library — built in Milestone 3. */}
        <View className="mt-10 items-center justify-center rounded-card border border-dashed border-line bg-white/60 px-6 py-14">
          <Text className="text-center text-base font-semibold text-ink">
            Your library is empty
          </Text>
          <Text className="mt-2 text-center text-sm leading-5 text-muted">
            Saves you share will show up here as a visual grid. (Capture &
            library land in the next milestones.)
          </Text>
        </View>

        {profile?.home_city ? (
          <Text className="mt-6 text-sm text-muted">
            Home city: {profile.home_city}
          </Text>
        ) : null}
      </View>

      <Button label="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}
