import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { api } from "./api";
import { env } from "./env";

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
    name: "Dibs",
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: "#9013BB",
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
  if (!Device.isDevice) {
    console.log("[Push] Skipped: not a physical device");
    return null;
  }

  // Must have permission before calling getExpoPushTokenAsync —
  // if it's missing the call throws and we'd silently return null.
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") {
    console.warn(`[Push] Skipped: notification permission is '${status}'. Grant it in device Settings.`);
    return null;
  }

  const projectId =
    env.easProjectId ||
    Constants.expoConfig?.extra?.eas?.projectId ||
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;

  if (!projectId) {
    console.warn("[Push] Skipped: no EAS projectId found in env or app.json extra.eas.projectId");
    return null;
  }

  console.log(`[Push] Fetching token (projectId: ${projectId})`);

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    console.log(`[Push] Token obtained: ${token.data.slice(0, 32)}…`);
    return token.data;
  } catch (err) {
    console.warn("[Push] getExpoPushTokenAsync failed:", err);
    return null;
  }
}

/** Register this device's push token for the signed-in user (spec §6.6). Idempotent. */
export async function registerDeviceToken(): Promise<void> {
  const token = await getExpoPushToken();
  if (!token) return;
  try {
    await api.put("/device-tokens", { token, platform: Platform.OS });
    console.log("[Push] Device token registered");
  } catch (err) {
    console.warn("[Push] Failed to register device token:", err);
  }
}

/** Unregister this device's token (sign-out), so the next user of the phone isn't sent the old account's pushes. */
export async function unregisterDeviceToken(): Promise<void> {
  const token = await getExpoPushToken();
  if (!token) return;
  await api.delete("/device-tokens", { token });
}

/** Tell the server a push notification was opened (powers throttling and tap-through stats). */
export async function markNotificationTapped(notificationId: string): Promise<void> {
  await api.post(`/notifications/${notificationId}/tapped`);
}
