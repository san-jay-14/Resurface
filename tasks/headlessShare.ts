import * as Notifications from "expo-notifications";
import { AppRegistry } from "react-native";

import { ensureAndroidChannel } from "@/lib/notifications";
import { enqueueWithShareToken } from "@/lib/shareToken";

type ShareData = { url: string };

// HeadlessJS boots the RN runtime from scratch in background. DNS resolution
// can fail for a second or two while the network stack wakes up. Wait longer
// and retry aggressively before giving up.
async function withRetry<T>(fn: () => Promise<T>, attempts = 6, delayMs = 500): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (attempts <= 1) throw e;
    await new Promise((r) => setTimeout(r, delayMs));
    return withRetry(fn, attempts - 1, Math.min(delayMs * 2, 5000));
  }
}

async function headlessShareHandler({ url }: ShareData) {
  // 1 second head-start: background runtime needs time for DNS resolver to
  // become available after the process wakes from sleep.
  await new Promise((r) => setTimeout(r, 1000));

  try {
    // Server-side: canonicalize, dedupe, create the save and queue enrichment. Authenticates with the
    // scoped share token minted at sign-in (the UI session isn't available to a headless task).
    const saved = await withRetry(() => enqueueWithShareToken(url));
    // No token: the user isn't signed in. Fail silently, no notification spam.
    if (!saved) return;
    const { saveId } = saved;

    await ensureAndroidChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Saved to Dibs",
        body: "I'll categorise it in the background.",
        data: { save_id: saveId },
      },
      trigger: null,
    });
  } catch (e) {
    console.error("[HeadlessShare]", e);
    try {
      await ensureAndroidChannel();
      await Notifications.scheduleNotificationAsync({
        content: { title: "Dibs", body: "Couldn't save that link — open Dibs to retry." },
        trigger: null,
      });
    } catch {}
  }
}

AppRegistry.registerHeadlessTask("DibsShareHandler", () => headlessShareHandler);
