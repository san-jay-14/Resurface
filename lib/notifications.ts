import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { env } from "./env";
import { supabase } from "./supabase";

// Show notifications even when the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Create the default Android notification channel (no-op elsewhere). */
export async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "Resurface",
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: "#FF6B4A",
  });
}

/**
 * Triggers the OS permission dialog. Call this AFTER the value-explaining
 * pre-prompt screen (spec §6.4). Returns whether permission was granted.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  await ensureAndroidChannel();
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/** Resolve the Expo push token for this device, or null if unavailable. */
export async function getExpoPushToken(): Promise<string | null> {
  // Push tokens only work on physical devices, not simulators/emulators.
  if (!Device.isDevice) return null;

  const projectId =
    env.easProjectId ||
    Constants.expoConfig?.extra?.eas?.projectId ||
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;

  if (!projectId) {
    // No EAS project yet (scaffold state) — token can't be minted. Not fatal.
    console.warn("No EAS projectId set; skipping push token registration.");
    return null;
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data;
  } catch (err) {
    console.warn("Failed to get Expo push token", err);
    return null;
  }
}

/** Upsert the device's push token against the user (spec §6.6). */
export async function registerDeviceToken(userId: string): Promise<void> {
  const token = await getExpoPushToken();
  if (!token) return;

  const { error } = await supabase.from("device_tokens").upsert(
    {
      user_id: userId,
      expo_push_token: token,
      platform: Platform.OS,
    },
    { onConflict: "expo_push_token" },
  );
  if (error) console.warn("Failed to register device token", error.message);
}
