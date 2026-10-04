import { api } from "@/lib/api";
import type { UserProfile } from "./database.types";

export type ProfilePatch = Partial<
  Pick<
    UserProfile,
    | "name"
    | "birthday"
    | "home_city"
    | "home_city_lat"
    | "home_city_lng"
    | "current_city"
    | "current_city_lat"
    | "current_city_lng"
    | "notification_prefs"
    | "onboarding_completed"
    | "wrapped_theme"
  >
>;

export async function fetchProfile(): Promise<UserProfile> {
  const { profile } = await api.get<{ profile: UserProfile }>("/me");
  return profile;
}

/** Patch the signed-in user's profile. Returns the updated profile. */
export async function updateProfile(patch: ProfilePatch): Promise<UserProfile> {
  const { profile } = await api.patch<{ profile: UserProfile }>("/me", patch);
  return profile;
}

/** Permanently delete the account and everything it owns. */
export const deleteAccount = () => api.delete("/me");

export interface UploadFile {
  uri: string;
  name: string;
  type: string;
}

/** Upload a new avatar (JPEG/PNG/WebP, max 5 MB). Returns the public URL. */
export async function uploadAvatar(file: UploadFile): Promise<string> {
  const form = new FormData();
  // React Native's FormData accepts { uri, name, type } descriptors in place of Blobs.
  form.append("file", file as unknown as Blob);
  const r = await api.post<{ avatar_url: string }>("/me/avatar", form, { timeoutMs: 60_000 });
  return r.avatar_url;
}

export const removeAvatar = () => api.delete("/me/avatar");
