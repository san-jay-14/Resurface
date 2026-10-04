import type { Queryable, Row } from "../client.ts";
import { json, one } from "../client.ts";

export interface NotificationPrefs {
  new_city: boolean;
  birthday: boolean;
  long_weekend: boolean;
  frequency: "normal" | "minimal";
}

export interface Profile extends Row {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  birthday: string | null;
  home_city: string | null;
  home_city_lat: number | null;
  home_city_lng: number | null;
  current_city: string | null;
  current_city_lat: number | null;
  current_city_lng: number | null;
  current_city_updated_at: Date | null;
  onboarding_completed: boolean;
  wrapped_theme: string | null;
  feature_flags: Record<string, boolean>;
  notification_prefs: NotificationPrefs;
  created_at: Date;
  updated_at: Date;
}

const PROFILE_COLUMNS = `id, name, email, avatar_url, birthday, home_city, home_city_lat, home_city_lng,
  current_city, current_city_lat, current_city_lng, current_city_updated_at, onboarding_completed,
  wrapped_theme, feature_flags, notification_prefs, created_at, updated_at`;

/**
 * Create the profile row from the identity if it does not exist yet. Idempotent, so it is safe
 * both as the auth `user.create` hook and as a self-healing step of GET /v1/me.
 */
export async function ensureProfile(q: Queryable, userId: string): Promise<void> {
  await q.query(
    `insert into users (id, name, email, avatar_url)
     select id, name, email, image from "user" where id = $1
     on conflict (id) do nothing`,
    [userId],
  );
}

export async function getProfile(q: Queryable, userId: string): Promise<Profile | null> {
  return one<Profile>(q, `select ${PROFILE_COLUMNS} from users where id = $1`, [userId]);
}

/** Fields a client may change. Anything not listed here (avatar_url, flags...) is server-owned. */
export interface ProfilePatch {
  name?: string | null;
  birthday?: string | null;
  home_city?: string | null;
  home_city_lat?: number | null;
  home_city_lng?: number | null;
  current_city?: string | null;
  current_city_lat?: number | null;
  current_city_lng?: number | null;
  onboarding_completed?: boolean;
  wrapped_theme?: string | null;
  notification_prefs?: NotificationPrefs;
}

const PATCHABLE = [
  "name",
  "birthday",
  "home_city",
  "home_city_lat",
  "home_city_lng",
  "current_city",
  "current_city_lat",
  "current_city_lng",
  "onboarding_completed",
  "wrapped_theme",
] as const;

export async function updateProfile(
  q: Queryable,
  userId: string,
  patch: ProfilePatch,
): Promise<Profile | null> {
  const sets: string[] = [];
  const params: unknown[] = [userId];
  for (const key of PATCHABLE) {
    if (key in patch) {
      params.push(patch[key] ?? null);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (patch.notification_prefs) {
    params.push(json(patch.notification_prefs));
    sets.push(`notification_prefs = $${params.length}::jsonb`);
  }
  if ("current_city" in patch || "current_city_lat" in patch || "current_city_lng" in patch) {
    sets.push("current_city_updated_at = now()");
  }
  if (sets.length === 0) return getProfile(q, userId);
  return one<Profile>(
    q,
    `update users set ${sets.join(", ")} where id = $1 returning ${PROFILE_COLUMNS}`,
    params,
  );
}

export async function setAvatar(q: Queryable, userId: string, url: string | null): Promise<void> {
  await q.query("update users set avatar_url = $2 where id = $1", [userId, url]);
}

/** Deleting the identity cascades to the profile and every user-owned row. */
export async function deleteUser(q: Queryable, userId: string): Promise<boolean> {
  const r = await q.query(`delete from "user" where id = $1`, [userId]);
  return r.rowCount > 0;
}
