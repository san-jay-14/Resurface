import type { UserProfile } from "./database.types";
import { supabase } from "./supabase";

/** Patch the signed-in user's profile row. Returns the updated row. */
export async function updateProfile(
  userId: string,
  patch: Partial<
    Pick<
      UserProfile,
      | "name"
      | "birthday"
      | "home_city"
      | "home_city_lat"
      | "home_city_lng"
      | "notif_frequency_pref"
      | "onboarding_completed"
    >
  >,
): Promise<UserProfile> {
  const { data, error } = await supabase
    .from("users")
    .update(patch)
    .eq("id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data as UserProfile;
}
