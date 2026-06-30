import "../global.css";
import "@/lib/notifications"; // side-effect: sets the foreground notification handler

import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { Stack, useRouter, useSegments, type Href } from "expo-router";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus, ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { detectAndUpdateCity } from "@/lib/location";
import { supabase } from "@/lib/supabase";
import { AlertProvider } from "@/providers/AlertProvider";
import { AuthProvider, useAuth } from "@/providers/AuthProvider";

function Loading() {
  return (
    <View className="flex-1 items-center justify-center bg-cream">
      <ActivityIndicator color="#9013BB" size="large" />
    </View>
  );
}

/**
 * Routing gate (spec §6 order: auth → onboarding → app).
 * Share intent takes priority once the user is authenticated + onboarded.
 */
function RootNavigator() {
  const { session, profile, initializing, refreshProfile } = useAuth();
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
      if (!inOnboarding) router.replace("/(onboarding)/welcome");
      return;
    }

    // Route to share screen while an intent is pending (spec §3.2).
    if (hasShareIntent) {
      if (!inShare) router.replace("/(share)" as Href);
      return;
    }

    if (!inApp) router.replace("/(app)");
  }, [resolving, session, profile, segments, router, hasShareIntent]);

  // Deep link handler — handles board invite links: dibs://board/join?code=XXXX
  // and universal links: https://getdibs.app/join/XXXX
  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (!url || !session) return;
      const parsed = Linking.parse(url);
      // dibs://board/join?code=XXXX
      if (parsed.scheme === "dibs" && parsed.path === "board/join" && parsed.queryParams?.code) {
        router.push({ pathname: "/(app)/boards/invite", params: {} } as never);
        return;
      }
      // https://getdibs.app/join/XXXX
      if (parsed.hostname === "getdibs.app" && typeof parsed.path === "string" && parsed.path.startsWith("/join/")) {
        const code = parsed.path.split("/join/")[1];
        if (code) {
          router.push({ pathname: "/(app)/boards/invite", params: {} } as never);
        }
      }
    };

    Linking.getInitialURL().then((url) => handleUrl(url));
    const sub = Linking.addEventListener("url", (e) => handleUrl(e.url));
    return () => sub.remove();
  }, [session]);

  // City detection — runs on every app foreground event (not on every render).
  // Updates users.current_city so the daily cron can fire the new-city trigger.
  const lastAppState = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    if (!session) return;
    const detectAndRefresh = () =>
      void detectAndUpdateCity(session.user.id).then((city) => {
        if (city) void refreshProfile();
      });
    const sub = AppState.addEventListener("change", (next) => {
      if (lastAppState.current !== "active" && next === "active") {
        detectAndRefresh();
      }
      lastAppState.current = next;
    });
    // Also run once on mount (covers cold start)
    detectAndRefresh();
    return () => sub.remove();
  }, [session, refreshProfile]);

  // Notification tap handler — runs for background→foreground taps and cold starts.
  // `useLastNotificationResponse` re-fires on every new tap; the ref prevents
  // replaying the same notification if the component re-renders.
  const lastResponse = Notifications.useLastNotificationResponse();
  const handledNotifId = useRef<string | null>(null);

  useEffect(() => {
    // Wait until auth/onboarding routing has settled so the push doesn't
    // land the user on a save before the routing gate fires.
    if (resolving || !lastResponse) return;

    const notifId = lastResponse.notification.request.identifier;
    if (handledNotifId.current === notifId) return;
    handledNotifId.current = notifId;

    const data = (lastResponse.notification.request.content.data ?? {}) as {
      save_id?: string;
      log_id?: string;
    };

    if (data.save_id) {
      router.push({ pathname: "/(app)/save/[id]", params: { id: data.save_id } } as never);
    }

    if (data.log_id) {
      supabase
        .from("notification_log")
        .update({ tapped: true })
        .eq("id", data.log_id)
        .then(({ error }) => {
          if (error) console.warn("[Notif] Failed to mark tapped:", error.message);
        });
    }
  }, [resolving, lastResponse]);

  if (resolving) return <Loading />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#FFFFFF" },
      }}
    />
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AlertProvider>
        <AuthProvider>
          <ShareIntentProvider>
            <StatusBar style="dark" />
            <RootNavigator />
          </ShareIntentProvider>
        </AuthProvider>
      </AlertProvider>
    </SafeAreaProvider>
  );
}
