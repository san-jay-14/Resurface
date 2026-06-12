import * as Notifications from "expo-notifications";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";

import { Button } from "@/components/Button";
import { CategoryPicker } from "@/components/CategoryPicker";
import { Screen } from "@/components/Screen";
import type { SaveCategory } from "@/lib/database.types";
import { ensureAndroidChannel } from "@/lib/notifications";
import {
  createManualSave,
  createPendingSave,
  detectPlatform,
  isAutoPlatform,
  triggerEnrich,
} from "@/lib/saves";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

type Mode = "detecting" | "auto" | "manual";
type SaveState = "idle" | "saving" | "success" | "error";

export default function ShareScreen() {
  const { shareIntent, resetShareIntent } = useShareIntentContext();
  const { session } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("detecting");
  const [category, setCategory] = useState<SaveCategory | null>(null);
  const [locationText, setLocationText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const didProcess = useRef(false);

  async function notifySaved() {
    try {
      await ensureAndroidChannel();
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Saved to Dibs",
          body: "I'll categorise it in the background.",
        },
        trigger: null,
      });
    } catch {
      // Non-critical — ignore
    }
  }

  // Safety net: if no share intent arrives within 3 s, bail back to app.
  useEffect(() => {
    const t = setTimeout(() => {
      if (mode === "detecting") {
        resetShareIntent();
        router.replace("/(app)");
      }
    }, 3000);
    return () => clearTimeout(t);
  }, [mode, resetShareIntent, router]);

  useEffect(() => {
    if (!shareIntent || !session || didProcess.current) return;
    didProcess.current = true;

    const url = shareIntent.webUrl ?? shareIntent.text ?? null;
    if (!url) {
      setMode("manual");
      return;
    }

    const platform = detectPlatform(url);

    if (platform === "instagram") {
      setMode("auto");
      setSaveState("saving");
      void (async () => {
        try {
          const save = await createPendingSave({
            userId: session.user.id,
            url,
            sourcePlatform: "instagram",
          });
          void supabase.functions.invoke("scrape-instagram", {
            body: { save_id: save.id, url },
          });
          void notifySaved();
          resetShareIntent();
          router.replace("/(app)");
        } catch {
          setSaveState("error");
          setErrorMsg("Couldn't save this link. Try again.");
        }
      })();
      return;
    }

    if (isAutoPlatform(platform)) {
      setMode("auto");
      setSaveState("saving");
      createPendingSave({ userId: session.user.id, url, sourcePlatform: platform })
        .then((save) => {
          void triggerEnrich(save.id);
          void notifySaved();
          resetShareIntent();
          router.replace("/(app)");
        })
        .catch(() => {
          setSaveState("error");
          setErrorMsg("Couldn't save this link. Try again.");
        });
    } else {
      setMode("manual");
    }
  }, [shareIntent, session, router, resetShareIntent]);

  async function handleManualSave(asUnsorted: boolean) {
    if (!session) return;
    const url = shareIntent?.webUrl ?? shareIntent?.text ?? undefined;
    const platform = url ? detectPlatform(url) : "instagram";
    const chosenCategory: SaveCategory = asUnsorted ? "unsorted" : category!;

    setSaveState("saving");
    try {
      await createManualSave({
        userId: session.user.id,
        category: chosenCategory,
        sourceUrl: url,
        sourcePlatform: platform,
        location: locationText.trim()
          ? { placeName: locationText.trim() }
          : undefined,
      });
      setSaveState("success");
      setTimeout(() => {
        resetShareIntent();
        router.replace("/(app)");
      }, 1000);
    } catch {
      setSaveState("error");
      setErrorMsg("Couldn't save. Try again.");
    }
  }

  // Full-screen states (detecting, auto path, scraping path)
  if (mode === "auto" || mode === "detecting") {
    const loadingText = "Saving…";

    return (
      <Screen className="items-center justify-center gap-5">
        {saveState === "saving" || saveState === "idle" ? (
          <>
            <ActivityIndicator color="#9013BB" size="large" />
            <Text className="text-base font-medium text-ink">{loadingText}</Text>
          </>
        ) : (
          <>
            <Text className="text-sm font-medium text-coral">
              {errorMsg ?? "Something went wrong."}
            </Text>
            <Button
              label="Go back"
              variant="secondary"
              onPress={() => {
                resetShareIntent();
                router.replace("/(app)");
              }}
            />
          </>
        )}
      </Screen>
    );
  }

  // Manual path
  const needsLocation = category === "places" || category === "shopping";
  const isSaving = saveState === "saving";

  return (
    <Screen className="py-6">
      <View className="flex-1 gap-6">
        <View className="gap-1">
          <Text className="text-2xl font-extrabold text-ink">What is this?</Text>
          <Text className="text-sm leading-5 text-muted">
            Pick a category — I'll bring it back at the right moment.
          </Text>
        </View>

        <CategoryPicker value={category} onChange={setCategory} />

        {needsLocation && (
          <View className="gap-2">
            <Text className="text-sm font-semibold text-ink">Where is it?</Text>
            <TextInput
              className="rounded-card border border-line bg-white px-4 py-3 text-base text-ink"
              placeholder="City or place name"
              placeholderTextColor="#8A7E74"
              value={locationText}
              onChangeText={setLocationText}
              returnKeyType="done"
            />
          </View>
        )}

        {saveState === "error" && (
          <Text className="text-sm text-coral">
            {errorMsg ?? "Something went wrong. Try again."}
          </Text>
        )}

        <View className="mt-auto gap-3">
          <Button
            label="Save"
            loading={isSaving}
            disabled={!category || isSaving}
            onPress={() => handleManualSave(false)}
          />
          <Button
            label="Just save it"
            variant="secondary"
            disabled={isSaving}
            onPress={() => handleManualSave(true)}
          />
        </View>
      </View>
    </Screen>
  );
}
