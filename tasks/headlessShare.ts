import * as Notifications from "expo-notifications";
import { AppRegistry } from "react-native";

import { ensureAndroidChannel } from "@/lib/notifications";
import { createPendingSave, detectPlatform, triggerEnrich } from "@/lib/saves";
import { supabase } from "@/lib/supabase";

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
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      // User hasn't logged in yet — fail silently, no notification spam
      return;
    }

    const platform = detectPlatform(url);

    const save = await withRetry(() =>
      createPendingSave({ userId: session.user.id, url, sourcePlatform: platform })
    );

    // Fire enrichment — do NOT await, it runs server-side
    if (platform === "instagram") {
      void supabase.functions.invoke("scrape-instagram", {
        body: { save_id: save.id, url },
      });
    } else {
      void triggerEnrich(save.id);
    }

    await ensureAndroidChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Saved to Dibs",
        body: "I'll categorise it in the background.",
        data: { save_id: save.id },
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
