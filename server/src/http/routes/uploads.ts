import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { createBugReport } from "../../db/repos/bugReports.ts";
import { setAvatar } from "../../db/repos/users.ts";
import { AppError, badRequest } from "../../errors.ts";
import { MAX_IMAGE_BYTES, detectImage } from "../../storage/images.ts";
import type { ObjectStore } from "../../storage/objectStore.ts";
import type { AppEnv, Services } from "../context.ts";
import { rateLimit } from "../middleware.ts";

/**
 * Uploads go THROUGH the API (not presigned PUTs) so type and size are validated server-side: a
 * presigned PUT cannot enforce a size limit and would trust the client's content type.
 */
const MAX_ATTACHMENTS = 4;
const IMMUTABLE = "public, max-age=31536000, immutable";

function requireStorage(svc: Services): ObjectStore {
  if (!svc.storage) {
    throw new AppError(503, "storage_unavailable", "Uploads are not available right now.");
  }
  return svc.storage;
}

/** Read one image part from a multipart body, validating size and magic bytes. */
async function readImage(
  file: unknown,
): Promise<{ bytes: Uint8Array; contentType: string; ext: string }> {
  if (!(file instanceof File)) throw badRequest("Expected an image file");
  if (file.size > MAX_IMAGE_BYTES)
    throw new AppError(413, "too_large", "Images can be at most 5 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = detectImage(bytes);
  if (!image)
    throw new AppError(415, "unsupported_media", "Only JPEG, PNG or WebP images are accepted.");
  return { bytes, ...image };
}

async function form(c: Context<AppEnv>): Promise<FormData> {
  try {
    return await c.req.formData();
  } catch {
    throw badRequest("Expected a multipart/form-data body");
  }
}

export function uploadRoutes(svc: Services): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.post(
    "/me/avatar",
    rateLimit({ windowMs: 60_000, max: 10, key: (c) => `avatar:${c.get("userId")}` }),
    async (c) => {
      const store = requireStorage(svc);
      const userId = c.get("userId");
      const img = await readImage((await form(c)).get("file"));

      // A unique key per upload means clients and CDNs never serve a stale avatar (no cache busting).
      const key = `avatars/${userId}/${randomUUID()}.${img.ext}`;
      await store.put(key, img.bytes, img.contentType, { cacheControl: IMMUTABLE });
      const url = store.publicUrl(key);
      await setAvatar(svc.db, userId, url);
      await store.deletePrefix(`avatars/${userId}/`, { except: key }).catch((err: unknown) => {
        c.get("log").warn({ err }, "failed to remove previous avatar");
      });
      return c.json({ avatar_url: url });
    },
  );

  r.delete("/me/avatar", async (c) => {
    const userId = c.get("userId");
    await setAvatar(svc.db, userId, null);
    await svc.storage?.deletePrefix(`avatars/${userId}/`).catch((err: unknown) => {
      c.get("log").warn({ err }, "failed to remove avatar objects");
    });
    return c.body(null, 204);
  });

  r.post(
    "/bug-reports",
    rateLimit({ windowMs: 60 * 60_000, max: 10, key: (c) => `bug:${c.get("userId")}` }),
    async (c) => {
      const userId = c.get("userId");
      const data = await form(c);
      const message = z.string().trim().min(1).max(4000).safeParse(data.get("message"));
      if (!message.success) throw badRequest("A message is required (max 4000 characters)");

      const files = data.getAll("attachments");
      if (files.length > MAX_ATTACHMENTS)
        throw badRequest(`At most ${MAX_ATTACHMENTS} attachments`);
      const images = await Promise.all(files.map(readImage));

      // Keys are unguessable and never returned to clients; only operators read them.
      const keys: string[] = [];
      if (images.length) {
        const store = requireStorage(svc);
        for (const img of images) {
          const key = `bug-reports/${userId}/${randomUUID()}.${img.ext}`;
          await store.put(key, img.bytes, img.contentType);
          keys.push(key);
        }
      }
      const id = await createBugReport(svc.db, userId, message.data, keys);
      return c.json({ id }, 201);
    },
  );

  return r;
}
