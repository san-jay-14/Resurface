import { Hono } from "hono";
import { z } from "zod";
import {
  deleteDeviceToken,
  markNotificationTapped,
  upsertDeviceToken,
} from "../../db/repos/notifications.ts";
import { revokeShareTokens, mintShareToken } from "../../db/repos/shareTokens.ts";
import { notFound } from "../../errors.ts";
import type { AppEnv, Services } from "../context.ts";
import { jsonBody, pathParams } from "../validate.ts";

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/;

const tokenSchema = z.object({
  token: z.string().regex(EXPO_TOKEN, "Not an Expo push token"),
  platform: z.enum(["ios", "android", "web"]).optional(),
});

export function deviceRoutes(svc: Services): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.put("/device-tokens", async (c) => {
    const { token, platform } = await jsonBody(c, tokenSchema);
    await upsertDeviceToken(svc.db, c.get("userId"), token, platform ?? null);
    return c.body(null, 204);
  });

  r.delete("/device-tokens", async (c) => {
    const { token } = await jsonBody(c, tokenSchema.pick({ token: true }));
    await deleteDeviceToken(svc.db, c.get("userId"), token);
    return c.body(null, 204);
  });

  r.post("/notifications/:id/tapped", async (c) => {
    const { id } = pathParams(c, z.object({ id: z.uuid() }));
    if (!(await markNotificationTapped(svc.db, c.get("userId"), id)))
      throw notFound("Notification");
    return c.body(null, 204);
  });

  // Credential for the Android share worker: scope = POST /v1/saves/enqueue only. Revoked on sign-out.
  r.post("/share-token", async (c) => {
    const { label } = await jsonBody(c, z.object({ label: z.string().trim().max(80).optional() }));
    const token = await mintShareToken(svc.db, c.get("userId"), label ?? null);
    return c.json({ token }, 201);
  });

  r.delete("/share-token", async (c) => {
    await revokeShareTokens(svc.db, c.get("userId"));
    return c.body(null, 204);
  });

  return r;
}
