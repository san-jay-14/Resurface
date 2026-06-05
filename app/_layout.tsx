import "../global.css";

import { Stack, useRouter, useSegments } from "expo-router";
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
 * Redirects whenever auth/onboarding state and the current route group disagree.
 */
function RootNavigator() {
  const { session, profile, initializing } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // While a session exists but its profile row hasn't loaded yet, hold — this
  // avoids flashing onboarding at returning users before we know their state.
  const resolving = initializing || (!!session && !profile);

  useEffect(() => {
    if (resolving) return;

    const group = segments[0];
    const inAuth = group === "(auth)";
    const inOnboarding = group === "(onboarding)";
    const inApp = group === "(app)";

    if (!session) {
      if (!inAuth) router.replace("/(auth)/sign-in");
      return;
    }

    const onboarded = profile?.onboarding_completed ?? false;
    if (!onboarded) {
      if (!inOnboarding) router.replace("/(onboarding)/birthday");
      return;
    }

    if (!inApp) router.replace("/(app)");
  }, [resolving, session, profile, segments, router]);

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
        <StatusBar style="dark" />
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
