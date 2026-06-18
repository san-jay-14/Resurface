import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";

import { supabase } from "./supabase";

const PROMPT_DISMISSED_KEY = "resurface_location_prompt_dismissed";
const LAST_CITY_NOTIFIED_KEY = "resurface_last_city_notified";

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

export async function getLocationPermissionStatus(): Promise<Location.PermissionStatus> {
  const { status } = await Location.getForegroundPermissionsAsync();
  return status;
}

export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  console.log(`[Location] Permission request result: ${status}`);
  return status === "granted";
}

// ---------------------------------------------------------------------------
// Contextual prompt state (shown once after 3 Places saves)
// ---------------------------------------------------------------------------

export async function isLocationPromptDismissed(): Promise<boolean> {
  const val = await AsyncStorage.getItem(PROMPT_DISMISSED_KEY);
  return val === "true";
}

export async function dismissLocationPrompt(): Promise<void> {
  await AsyncStorage.setItem(PROMPT_DISMISSED_KEY, "true");
}

// ---------------------------------------------------------------------------
// City detection + DB update
// ---------------------------------------------------------------------------

/** Reverse-geocodes the device's current position to a city name.
 *  Returns null if permission is missing or detection fails. */
async function getCurrentCity(): Promise<{
  city: string;
  lat: number;
  lng: number;
} | null> {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== "granted") return null;

  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced, // city-level; conserves battery
    });

    const [place] = await Location.reverseGeocodeAsync({
      latitude:  pos.coords.latitude,
      longitude: pos.coords.longitude,
    });

    // expo-location returns city, subregion, or region depending on the locale
    const city = place?.city ?? place?.subregion ?? place?.region ?? null;
    if (!city) return null;

    return { city, lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch (err) {
    console.warn("[Location] Detection failed:", err);
    return null;
  }
}

/** Fires a one-off local notification about un-acted-on Places saves in
 *  `city`, but at most once per distinct city (tracked via AsyncStorage) so
 *  it doesn't repeat on every app foreground while the user stays put. */
async function notifyNewCityPlaces(userId: string, city: string): Promise<void> {
  const lastNotifiedCity = await AsyncStorage.getItem(LAST_CITY_NOTIFIED_KEY);
  if (lastNotifiedCity?.toLowerCase() === city.toLowerCase()) return;

  const { data: locationRows } = await supabase
    .from("save_locations")
    .select("save_id, place_name")
    .ilike("city", `%${city}%`);

  const saveIds = (locationRows ?? []).map((r) => r.save_id as string);
  if (saveIds.length === 0) return;

  const { data: saves } = await supabase
    .from("saves")
    .select("id, title, ai_description, caption")
    .eq("user_id", userId)
    .eq("category", "places")
    .eq("acted_on", false)
    .eq("archived", false)
    .in("id", saveIds)
    .limit(5);

  if (!saves || saves.length === 0) return;

  // Mark this city as notified before scheduling so a concurrent foreground
  // event can't fire the same notification twice.
  await AsyncStorage.setItem(LAST_CITY_NOTIFIED_KEY, city);

  const top = saves[0];
  const label = (top.title as string | null)
    ?? (top.ai_description as string | null)
    ?? (top.caption as string | null)
    ?? "a saved spot";

  const body = saves.length === 1
    ? `You saved "${label}" here — want to check it out?`
    : `You've got ${saves.length} saves in ${city}, including "${label}". Go explore?`;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `You're in ${city} 📍`,
      body,
      data: { save_id: top.id, trigger_type: "new_city" },
      sound: "default",
    },
    trigger: null,
  });

  console.log(`[Location] Resurface notification sent for ${city} (${saves.length} saves)`);
}

/** Called on app foreground. Compares detected city with stored current_city,
 *  updates the DB row if they differ, and — when the detected city isn't the
 *  user's home city — checks for un-acted-on saves there and resurfaces them
 *  via a local notification. Returns the detected city, or null if detection
 *  failed, so the caller can refresh any cached profile state. */
export async function detectAndUpdateCity(userId: string): Promise<string | null> {
  const detected = await getCurrentCity();
  if (!detected) return null;

  const { data: user } = await supabase
    .from("users")
    .select("current_city, home_city")
    .eq("id", userId)
    .single();

  const stored = (user?.current_city as string | null) ?? null;
  const homeCity = (user?.home_city as string | null) ?? null;

  if (stored?.toLowerCase() !== detected.city.toLowerCase()) {
    const { error } = await supabase
      .from("users")
      .update({
        current_city:            detected.city,
        current_city_lat:        detected.lat,
        current_city_lng:        detected.lng,
        current_city_updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (error) {
      console.warn("[Location] Failed to update current_city:", error.message);
      return null;
    }
    console.log(`[Location] City updated: ${stored ?? "none"} → ${detected.city}`);
  }

  if (homeCity && homeCity.toLowerCase() === detected.city.toLowerCase()) {
    // Back home — clear the dedupe flag so the next trip notifies again.
    await AsyncStorage.removeItem(LAST_CITY_NOTIFIED_KEY);
  } else {
    void notifyNewCityPlaces(userId, detected.city);
  }

  return detected.city;
}
