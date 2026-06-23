import type { UserProfile } from "./database.types";
import { supabase } from "./supabase";

/** Patch the signed-in user's profile row. Returns the updated row. */
export async function updateProfile(
  userId: string,
  patch: Partial<
    Pick<
      UserProfile,
      | "name"
      | "avatar_url"
      | "birthday"
      | "home_city"
      | "home_city_lat"
      | "home_city_lng"
      | "notif_frequency_pref"
      | "notification_prefs"
      | "onboarding_completed"
    >
  >,
): Promise<UserProfile> {
  // Upsert so the row is created if the handle_new_user trigger missed this
  // user (e.g. they signed up before migrations were applied).
  const { data, error } = await supabase
    .from("users")
    .upsert({ id: userId, ...patch }, { onConflict: "id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as UserProfile;
}
