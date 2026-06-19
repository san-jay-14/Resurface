import AsyncStorage from "@react-native-async-storage/async-storage";

const LAST_SEEN_KEY = "resurface_activity_last_seen";

/** ISO timestamp of when the user last opened the Activity screen, or null
 *  if they've never opened it. */
export async function getActivityLastSeen(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_SEEN_KEY);
}

/** Call when the Activity screen is opened so the home screen's unread
 *  badge clears. */
export async function markActivitySeen(): Promise<void> {
  await AsyncStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
}
