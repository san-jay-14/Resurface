import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";

import { supabase } from "./supabase";

const PROMPT_DISMISSED_KEY = "resurface_location_prompt_dismissed";

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

/** Called on app foreground. Compares detected city with stored current_city
 *  and updates the DB row if they differ. The daily cron reads current_city
 *  to decide whether to fire the new-city trigger. */
export async function detectAndUpdateCity(userId: string): Promise<void> {
  const detected = await getCurrentCity();
  if (!detected) return;

  const { data: user } = await supabase
    .from("users")
    .select("current_city")
    .eq("id", userId)
    .single();

  const stored = (user?.current_city as string | null) ?? null;
  if (stored?.toLowerCase() === detected.city.toLowerCase()) return; // no change

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
  } else {
    console.log(`[Location] City updated: ${stored ?? "none"} → ${detected.city}`);
  }
}
