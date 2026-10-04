import { Hono } from "hono";
import { z } from "zod";
import { findOrCreateSave } from "../../db/repos/enrichment.ts";
import { enqueueFetchJob } from "../../db/repos/pipelineJobs.ts";
import { AppError } from "../../errors.ts";
import { CanonicalizeError, canonicalizeUrl } from "../../pipeline/canonicalize.ts";
import type { AppEnv, Services } from "../context.ts";
import { authenticate, rateLimit } from "../middleware.ts";
import { jsonBody } from "../validate.ts";

const bodySchema = z.object({ url: z.string().trim().min(1).max(4096) }).strict();

const REASON_MESSAGES: Record<CanonicalizeError["reason"], string> = {
  no_url: "That doesn't look like a link.",
  unsupported: "That kind of link isn't supported.",
  unresolvable: "We couldn't work out which post that link points to.",
  blocked: "That link can't be fetched.",
};

/**
 * The share handler's entry point. Accepts the session cookie OR a share token (the Android share
 * worker's scoped credential: this is the ONLY route that accepts one). Canonicalizes the URL and
 * creates the save plus ONE fetch job. Both inserts are idempotent (unique (user, platform,
 * content_id) and unique (save, stage)), so retries and double-shares never duplicate.
 */
export function enqueueRoutes(svc: Services): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.post(
    "/saves/enqueue",
    authenticate(svc, { allowShareToken: true }),
    rateLimit({
      windowMs: 60_000,
      max: svc.config.pipeline.userEnqueuePerMinute,
      key: (c) => `enqueue:${c.get("userId")}`,
    }),
    async (c) => {
      const userId = c.get("userId");
      const { url } = await jsonBody(c, bodySchema);

      let canonical;
      try {
        canonical = await canonicalizeUrl(svc.registry, url);
      } catch (e) {
        if (e instanceof CanonicalizeError) {
          throw new AppError(422, e.reason, REASON_MESSAGES[e.reason]);
        }
        throw e;
      }

      const save = await findOrCreateSave(svc.db, userId, {
        platform: canonical.platform,
        contentId: canonical.contentId,
        sourceUrl: canonical.sourceUrl,
      });
      await enqueueFetchJob(svc.db, save.id, canonical.platform, canonical.contentId);
      if (save.created) svc.kicker.kick();

      return c.json(
        {
          save_id: save.id,
          created: save.created,
          platform: canonical.platform,
          content_id: canonical.contentId,
        },
        save.created ? 201 : 200,
      );
    },
  );

  return r;
}
