import "../global.css";

import { Stack, useRouter, useSegments, type Href } from "expo-router";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/providers/AuthProvider";

function Loading() {
  return (
    <View className="flex-1 items-center justify-center bg-cream">
      <ActivityIndicator color="#FF6B4A" size="large" />
    </View>
  );
}

/**
 * Routing gate (spec §6 order: auth → onboarding → app).
 * Share intent takes priority once the user is authenticated + onboarded.
 */
function RootNavigator() {
  const { session, profile, initializing } = useAuth();
  const { hasShareIntent } = useShareIntentContext();
  const segments = useSegments();
  const router = useRouter();

  // Only block on initializing — loadProfile is awaited before initializing
  // is set to false, so the profile result is already known by then.
  // Do NOT include profileLoading here: toggling resolving unmounts the Stack
  // and resets navigation to the first route in the group.
  const resolving = initializing;

  useEffect(() => {
    if (resolving) return;

    const group = segments[0] as string | undefined;
    const inAuth = group === "(auth)";
    const inOnboarding = group === "(onboarding)";
    const inApp = group === "(app)";
    const inShare = group === "(share)";

    if (!session) {
      if (!inAuth) router.replace("/(auth)/sign-in");
      return;
    }

    const onboarded = profile?.onboarding_completed ?? false;
    if (!onboarded) {
      if (!inOnboarding) router.replace("/(onboarding)/birthday");
      return;
    }

    // Route to share screen while an intent is pending (spec §3.2).
    if (hasShareIntent) {
      if (!inShare) router.replace("/(share)" as Href);
      return;
    }

    if (!inApp) router.replace("/(app)");
  }, [resolving, session, profile, segments, router, hasShareIntent]);

  if (resolving) return <Loading />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#FFF8F2" },
      }}
    />
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ShareIntentProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </ShareIntentProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
