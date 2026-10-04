import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { AppError, unauthorized } from "../../errors.ts";
import { runDueTasks } from "../../scheduler/runner.ts";
import type { AppEnv, Services } from "../context.ts";

/** Constant-time string comparison (length is not a secret here). */
export function secretsMatch(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /internal/tick: run whatever scheduled work is due. Called by a free external pinger
 * (cron-job.org) because the free web host sleeps and has no cron. Idempotent and safe to call
 * concurrently. Responds immediately (202) and works in the background so a slow tick never trips
 * the pinger's short timeout; `?wait=true` returns the results instead (used by tests and humans).
 */
export function internalRoutes(svc: Services): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  let ticking = false;

  r.post("/internal/tick", async (c) => {
    if (!svc.config.tickSecret) {
      throw new AppError(503, "not_configured", "TICK_SECRET is not configured");
    }
    const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!secretsMatch(bearer, svc.config.tickSecret)) throw unauthorized();

    if (ticking) return c.json({ status: "already_running" }, 202);
    ticking = true;
    const work = runDueTasks(svc, svc.tasks).finally(() => {
      ticking = false;
    });

    if (c.req.query("wait") === "true") return c.json({ status: "done", results: await work });
    work.catch((err: unknown) => c.get("log").error({ err }, "tick failed"));
    return c.json({ status: "started" }, 202);
  });

  return r;
}
