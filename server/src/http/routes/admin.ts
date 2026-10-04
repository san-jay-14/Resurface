import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { z } from "zod";
import { type Queryable } from "../../db/client.ts";
import { clearPost } from "../../db/repos/pipelineCache.ts";
import { listDeadLetter, listProviderCalls, overview } from "../../db/repos/pipelineAdmin.ts";
import { listEvents, listRuns, runEvents } from "../../db/repos/pipelineEvents.ts";
import { getFlag, resetBreaker, setFlag } from "../../db/repos/pipelineHealth.ts";
import { listJobs, retryDeadJobs } from "../../db/repos/pipelineJobs.ts";
import { AppError, unauthorized } from "../../errors.ts";
import { CanonicalizeError, canonicalizeUrl } from "../../pipeline/canonicalize.ts";
import { drainOnce } from "../../pipeline/drain.ts";
import { type Outcome, runTarget } from "../../pipeline/process.ts";
import { emit, errMessage, flush, newRun } from "../../pipeline/trace.ts";
import { runDueTasks } from "../../scheduler/runner.ts";
import type { AppEnv, Services } from "../context.ts";
import { jsonBody } from "../validate.ts";
import { secretsMatch } from "./internal.ts";

/**
 * Admin dashboard: a static page at /admin plus a JSON API at /admin/api, both same-origin.
 * Auth is a shared token (ADMIN_DASHBOARD_TOKEN, 24+ chars). The token unlocks pipeline internals
 * (no user content beyond ids), so keep it secret; with no token configured the API is disabled.
 */
const HTML_URL = new URL("../../../public/admin/index.html", import.meta.url);

const limit = (def: number, max: number) => z.coerce.number().int().min(1).max(max).default(def);

const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("overview") }),
  z.object({
    action: z.literal("runs"),
    limit: limit(50, 200),
    only_errors: z.boolean().optional(),
    platform: z.enum(["instagram", "youtube", "web"]).optional(),
    job_id: z.number().int().optional(),
    save_id: z.uuid().optional(),
    q: z.string().max(64).optional(),
  }),
  z.object({ action: z.literal("run_events"), run_id: z.uuid() }),
  z.object({
    action: z.literal("events"),
    limit: limit(100, 500),
    status: z.enum(["ok", "error", "warn", "skip", "info"]).optional(),
    step: z.string().max(64).optional(),
    before_id: z.number().int().optional(),
  }),
  z.object({
    action: z.literal("jobs"),
    limit: limit(100, 300),
    status: z.enum(["queued", "running", "done", "dead"]).optional(),
    stage: z.enum(["fetch", "comments", "frames", "classify", "refresh"]).optional(),
  }),
  z.object({ action: z.literal("dead") }),
  z.object({ action: z.literal("provider_calls"), limit: limit(100, 300) }),
  z.object({ action: z.literal("retry_job"), id: z.number().int() }),
  z.object({ action: z.literal("retry_all_dead") }),
  z.object({ action: z.literal("set_flag"), key: z.string().max(64), enabled: z.boolean() }),
  z.object({ action: z.literal("reset_breaker"), provider: z.string().max(64) }),
  z.object({ action: z.literal("drain_now") }),
  z.object({ action: z.literal("run_task"), name: z.string().max(64) }),
  z.object({
    action: z.literal("run_url"),
    url: z.string().min(1).max(4096),
    bypass_cache: z.boolean().optional(),
  }),
]);

function describeOutcome(o: Outcome): string {
  switch (o.kind) {
    case "done":
      return `done (${o.via})`;
    case "needs_review":
      return `needs_review (${o.reason})`;
    case "awaiting_frames":
      return "unresolved from text — would hand off to the frames stage";
    case "requeue":
      return `would requeue until ${o.at.toISOString()} (${o.reason})`;
    case "retry":
      return `would retry with backoff: ${o.error}`;
  }
}

export function adminRoutes(svc: Services): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  let html: string | null = null;

  r.get("/admin", async (c) => {
    html ??= await readFile(HTML_URL, "utf8");
    c.header(
      "content-security-policy",
      "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    c.header("cache-control", "no-store");
    return c.html(html);
  });

  r.post("/admin/api", async (c) => {
    const expected = svc.config.adminToken;
    if (!expected)
      throw new AppError(503, "not_configured", "ADMIN_DASHBOARD_TOKEN is not configured");
    if (!secretsMatch(c.req.header("x-admin-token"), expected)) throw unauthorized();

    const a = await jsonBody(c, actions);
    const db: Queryable = svc.db;

    switch (a.action) {
      case "overview":
        return c.json({
          ...(await overview(db)),
          config: {
            threshold: svc.config.pipeline.confidenceThreshold,
            promptVersion: svc.config.pipeline.promptVersion,
            model: svc.config.pipeline.classifierModel,
          },
        });
      case "runs":
        return c.json({
          runs: await listRuns(db, {
            limit: a.limit,
            ...(a.only_errors ? { onlyErrors: true } : {}),
            ...(a.platform ? { platform: a.platform } : {}),
            ...(a.job_id !== undefined ? { jobId: a.job_id } : {}),
            ...(a.save_id ? { saveId: a.save_id } : {}),
            ...(a.q ? { contentIdLike: a.q.replace(/[\\%_]/g, (m) => `\\${m}`) } : {}),
          }),
        });
      case "run_events":
        return c.json({ events: await runEvents(db, a.run_id) });
      case "events":
        return c.json({
          events: await listEvents(db, {
            limit: a.limit,
            ...(a.status ? { status: a.status } : {}),
            ...(a.step ? { step: a.step } : {}),
            ...(a.before_id !== undefined ? { beforeId: a.before_id } : {}),
          }),
        });
      case "jobs":
        return c.json({
          jobs: await listJobs(db, {
            limit: a.limit,
            ...(a.status ? { status: a.status } : {}),
            ...(a.stage ? { stage: a.stage } : {}),
          }),
        });
      case "dead":
        return c.json({ jobs: await listDeadLetter(db) });
      case "provider_calls":
        return c.json({ calls: await listProviderCalls(db, a.limit) });
      case "retry_job":
        return c.json({ ok: true, requeued: await retryDeadJobs(svc.db, a.id) });
      case "retry_all_dead":
        return c.json({ ok: true, requeued: await retryDeadJobs(svc.db) });
      case "set_flag":
        if (!(await setFlag(db, a.key, a.enabled)))
          throw new AppError(400, "bad_request", "Unknown flag");
        return c.json({ ok: true, enabled: await getFlag(db, a.key) });
      case "reset_breaker":
        await resetBreaker(db, a.provider);
        return c.json({ ok: true });
      case "drain_now":
        return c.json({ ok: true, ...(await drainOnce(svc)) });
      case "run_task": {
        const results = await runDueTasks(svc, svc.tasks, [a.name]);
        return c.json({ ok: true, results });
      }
      case "run_url": {
        // Dry run: executes every pipeline step for a URL with NO save and NO job, so it is safe to
        // try anything. It does fill the shared caches and makes real provider/model calls.
        const run = newRun(svc);
        let canonical;
        try {
          canonical = await canonicalizeUrl(svc.registry, a.url);
        } catch (e) {
          const msg = e instanceof CanonicalizeError ? e.message : errMessage(e);
          emit(run, "canonicalize", "error", msg);
          await flush(run);
          return c.json({ ok: false, run_id: run.runId, error: msg });
        }
        run.platform = canonical.platform;
        run.contentId = canonical.contentId;
        const shown =
          canonical.contentId.length > 16
            ? `${canonical.contentId.slice(0, 16)}…`
            : canonical.contentId;
        emit(run, "canonicalize", "ok", `${canonical.platform} · ${shown}`);
        if (a.bypass_cache) {
          await clearPost(db, canonical.platform, canonical.contentId);
          emit(
            run,
            "cache_bypass",
            "info",
            "cleared cached analysis + post for this URL before running",
          );
        }
        const outcome = await runTarget(svc, run, {
          platform: canonical.platform,
          contentId: canonical.contentId,
          sourceUrl: canonical.sourceUrl,
          attempts: 1,
          stage: "fetch",
          writeback: false,
        });
        emit(
          run,
          "result",
          outcome.kind === "done"
            ? "ok"
            : outcome.kind === "needs_review" || outcome.kind === "retry"
              ? "warn"
              : "info",
          describeOutcome(outcome),
        );
        await flush(run);
        return c.json({ ok: true, run_id: run.runId, outcome: outcome.kind });
      }
    }
  });

  return r;
}
