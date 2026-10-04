import { Hono } from "hono";
import { z } from "zod";
import { deleteUser, ensureProfile, getProfile, updateProfile } from "../../db/repos/users.ts";
import { notFound } from "../../errors.ts";
import type { AppEnv, Services } from "../context.ts";
import { jsonBody } from "../validate.ts";

const city = z.string().trim().min(1).max(120).nullable();
const lat = z.number().min(-90).max(90).nullable();
const lng = z.number().min(-180).max(180).nullable();

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).nullable(),
    birthday: z.iso.date().nullable(),
    home_city: city,
    home_city_lat: lat,
    home_city_lng: lng,
    current_city: city,
    current_city_lat: lat,
    current_city_lng: lng,
    onboarding_completed: z.boolean(),
    wrapped_theme: z.string().trim().max(40).nullable(),
    notification_prefs: z.object({
      new_city: z.boolean(),
      birthday: z.boolean(),
      long_weekend: z.boolean(),
      frequency: z.enum(["normal", "minimal"]),
    }),
  })
  .partial()
  .strict();

export function meRoutes(svc: Services): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/", async (c) => {
    const userId = c.get("userId");
    let profile = await getProfile(svc.db, userId);
    if (!profile) {
      await ensureProfile(svc.db, userId); // self-heal if the create hook failed
      profile = await getProfile(svc.db, userId);
    }
    if (!profile) throw notFound("Profile");
    return c.json({ profile });
  });

  r.patch("/", async (c) => {
    const userId = c.get("userId");
    const patch = await jsonBody(c, patchSchema);
    await ensureProfile(svc.db, userId);
    const profile = await updateProfile(svc.db, userId, patch);
    if (!profile) throw notFound("Profile");
    return c.json({ profile });
  });

  // Account deletion (required by the App Store for apps that offer account creation).
  r.delete("/", async (c) => {
    const userId = c.get("userId");
    if (svc.storage) {
      for (const prefix of [`avatars/${userId}/`, `bug-reports/${userId}/`]) {
        try {
          await svc.storage.deletePrefix(prefix);
        } catch (err) {
          c.get("log").error(
            { err, prefix },
            "failed to delete stored objects during account deletion",
          );
        }
      }
    }
    await deleteUser(svc.db, userId);
    c.get("log").info({ userId }, "account deleted");
    return c.body(null, 204);
  });

  return r;
}
