import { Hono } from "hono";
import { z } from "zod";
import { ProviderError } from "../../adapters/types.ts";
import {
  getWrapped,
  insertWrapped,
  listWrapped,
  recentWrapped,
  savesForWrapped,
} from "../../db/repos/wrapped.ts";
import {
  DEFAULT_WINDOW_DAYS,
  MIN_SAVES,
  computeStats,
  isValidTimeZone,
  writeWrappedCopy,
} from "../../domain/wrapped.ts";
import { AppError, notFound } from "../../errors.ts";
import { ProviderUnavailable } from "../../pipeline/health.ts";
import type { AppEnv, Services } from "../context.ts";
import { jsonBody, pathParams } from "../validate.ts";

const DAILY_LIMIT = 3;
const REUSE_WINDOW_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;

const createSchema = z
  .object({
    /** Start of the window (YYYY-MM-DD); defaults to the last 60 days. */
    period_start: z.iso.date().optional(),
    /** The device's IANA timezone, so "peak save hour" is the user's hour, not the server's. */
    tz: z.string().max(64).optional(),
  })
  .strict();

export function wrappedRoutes(svc: Services): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const { db } = svc;

  r.get("/wrapped", async (c) => c.json({ wrapped: await listWrapped(db, c.get("userId")) }));

  r.get("/wrapped/:id", async (c) => {
    const { id } = pathParams(c, z.object({ id: z.uuid() }));
    const row = await getWrapped(db, c.get("userId"), id);
    if (!row) throw notFound("Wrapped");
    return c.json({ wrapped: row });
  });

  r.post("/wrapped", async (c) => {
    const userId = c.get("userId");
    const body = await jsonBody(c, createSchema);
    const now = svc.now();
    const periodStart = body.period_start
      ? new Date(`${body.period_start}T00:00:00Z`)
      : new Date(now.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);
    const periodKey = periodStart.toISOString().slice(0, 10);
    const tz = body.tz && isValidTimeZone(body.tz) ? body.tz : "UTC";

    // Idempotent for double-taps; capped because every generation is a paid model call.
    const recent = await recentWrapped(db, userId, new Date(now.getTime() - DAY_MS));
    const reusable = recent.find(
      (w) =>
        w.period_start === periodKey && now.getTime() - w.created_at.getTime() < REUSE_WINDOW_MS,
    );
    if (reusable) {
      const existing = await getWrapped(db, userId, reusable.id);
      if (existing) return c.json({ wrapped: existing, reused: true });
    }
    if (recent.length >= DAILY_LIMIT) {
      throw new AppError(
        429,
        "wrapped_limit",
        "You've generated a few cards today. Try again tomorrow.",
      );
    }

    const saves = await savesForWrapped(db, userId, periodStart);
    if (saves.length < MIN_SAVES) {
      throw new AppError(
        422,
        "not_enough_saves",
        "You need a few more saves before your first Wrapped. Keep going 👀",
      );
    }
    const stats = computeStats(saves, now, tz);

    let copy;
    try {
      copy = await writeWrappedCopy(svc.llm, svc.config.pipeline.rulesModel, stats);
    } catch (err) {
      if (err instanceof ProviderError || err instanceof ProviderUnavailable) {
        throw new AppError(
          503,
          "ai_unavailable",
          "Couldn't generate your card right now. Try again later.",
        );
      }
      throw err;
    }
    if (!copy)
      throw new AppError(
        502,
        "bad_model_output",
        "Couldn't generate your card right now. Try again later.",
      );

    const wrapped = await insertWrapped(db, userId, { periodStart: periodKey, stats, copy });
    return c.json({ wrapped, reused: false }, 201);
  });

  return r;
}
