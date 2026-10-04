import {
  type PlatformAdapter,
  type PostMeta,
  ProviderError,
  type RawResult,
  SchemaDrift,
} from "../adapters/types.ts";
import { finalizeSave, markNeedsReview } from "../db/repos/enrichment.ts";
import {
  type AnalysisRow,
  type ResolvedBy,
  type SpotRow,
  getAnalysis,
  getPostCache,
  lockPost,
  releaseLock,
  saveComments,
  updateAnalysisSpots,
  upsertAnalysis,
  writeDrift,
  writeNegative,
  writeOk,
} from "../db/repos/pipelineCache.ts";
import { getOwnSubmission } from "../db/repos/deviceMeta.ts";
import {
  enqueueFramesJob,
  killJob,
  markJobDone,
  requeueJob,
  retryJob,
  userEnrichmentCountToday,
} from "../db/repos/pipelineJobs.ts";
import {
  addDays,
  addHours,
  cachedComments,
  contentHash,
  isFreshOk,
  isNegativeFresh,
  mirrorThumbnail,
  staleMeta,
} from "./cache.ts";
import { ClassificationInvalid, type Classification } from "./classify.ts";
import type { PipelineContext } from "./context.ts";
import {
  type Availability,
  backoffMs,
  nextPacificMidnight,
  nextUtcMidnight,
  ProviderUnavailable,
} from "./health.ts";
import { runLadder } from "./ladder.ts";
import { emit, errMessage, type RunCtx, traced } from "./trace.ts";

/**
 * The per-job pipeline, identical for every platform:
 *   prepare:   analysis cache -> post cache -> provider gate -> user cap -> single-flight
 *   fetch:     adapter fetch (batched where supported) -> normalize -> cache write
 *   classify:  fallback ladder -> place resolution -> analysis cache -> write-back
 * Every step emits a trace event (rendered by the admin dashboard). Platform knowledge lives only in
 * adapters/: this file never branches on the platform.
 */
export interface Target {
  platform: string;
  contentId: string;
  sourceUrl?: string | null;
  saveId?: string | null;
  userId?: string | null;
  jobId?: number | null;
  attempts: number;
  /**
   * Set by prepare() when the metadata came from the user's own (untrusted) device submission. Such
   * metadata may finalize this user's save but must never reach a globally shared cache.
   */
  metaSource?: "device";
  stage: "fetch" | "refresh";
  /** false for dashboard dry-runs and refresh: analysis is cached but no save is touched. */
  writeback: boolean;
}

export type Outcome =
  | { kind: "done"; via: "analysis_cache" | "classified" | "refreshed" }
  | { kind: "awaiting_frames" }
  | { kind: "needs_review"; reason: string; meta?: PostMeta | null }
  | { kind: "requeue"; at: Date; consumeAttempt: boolean; reason: string }
  | { kind: "retry"; error: string; retryAfterMs?: number };

export type Prepared =
  | { kind: "final"; outcome: Outcome }
  | { kind: "meta"; meta: PostMeta; stale: boolean }
  | { kind: "need_fetch" };

const requeue = (at: Date, reason: string, consumeAttempt = false): Outcome => ({
  kind: "requeue",
  at,
  consumeAttempt,
  reason,
});

// ---------------------------------------------------------------------------
// prepare: analysis cache, post cache, provider gate, user cap, single-flight
// ---------------------------------------------------------------------------
export async function prepare(ctx: PipelineContext, run: RunCtx, t: Target): Promise<Prepared> {
  const { db, config } = ctx;
  const adapter = ctx.registry.byId(t.platform);
  const now = ctx.now();

  if (t.stage === "fetch") {
    const analysis = await getAnalysis(
      db,
      t.platform,
      t.contentId,
      config.pipeline.promptVersion,
      config.pipeline.classifierModel,
    );
    emit(
      run,
      "analysis_cache",
      analysis ? "ok" : "info",
      analysis
        ? `hit (${analysis.category}, via ${analysis.resolved_by}) — copying to save, zero provider/model calls`
        : "miss",
      { meta: { hit: !!analysis } },
    );
    if (analysis) {
      const row = await getPostCache(db, t.platform, t.contentId);
      return {
        kind: "final",
        outcome: await applyCachedAnalysis(ctx, run, t, analysis, row?.meta ?? null),
      };
    }
  }

  const row = await getPostCache(db, t.platform, t.contentId);
  if (t.stage === "fetch") {
    if (isFreshOk(row, now)) {
      emit(run, "post_cache", "ok", "hit — fresh metadata, skipping provider call", {
        meta: { hit: true },
      });
      return { kind: "meta", meta: row.meta, stale: false };
    }
    // The user's own device-fetched metadata (untrusted): saves a provider call for THIS save only.
    // It sits after the trusted cache and before the negative cache and the provider gate.
    if (t.userId && adapter.fromDevice) {
      const own = await getOwnSubmission(db, t.userId, t.platform, t.contentId);
      if (own?.text) {
        t.metaSource = "device";
        emit(
          run,
          "device_meta",
          "ok",
          "using this user's device-fetched metadata — no provider call (not shared with other users)",
        );
        return { kind: "meta", meta: own, stale: false };
      }
    }
    if (isNegativeFresh(row, now)) {
      emit(run, "post_cache", "ok", `negative cache hit (${row.status}) — not refetching`, {
        meta: { hit: true },
      });
      return { kind: "final", outcome: { kind: "needs_review", reason: row.status } };
    }
    emit(run, "post_cache", "info", row?.meta ? "stale — refetching" : "miss", {
      meta: { hit: false },
    });
  }

  // Provider gate: breaker open or budget spent -> serve stale cache, else wait it out.
  // With a provider chain the gate only closes when EVERY provider is unavailable; the adapter skips
  // the closed ones. An empty chain skips the gate: the fetch fails fast and the save degrades to
  // whatever the device supplied (thumbnail-only).
  const providers = adapter.policy.providers ?? [adapter.policy.provider];
  const avail = await Promise.all(providers.map((p) => ctx.health.availability(p)));
  const closed = avail.filter((a) => !a.ok);
  const av: Availability =
    providers.length && closed.length === providers.length
      ? closed.reduce((a, b) => (!a.ok && !b.ok && b.until < a.until ? b : a))
      : { ok: true };
  if (!av.ok) {
    const stale = t.stage === "fetch" ? staleMeta(row, now) : null;
    if (stale) {
      emit(
        run,
        "provider_gate",
        "warn",
        `${adapter.policy.provider} ${av.reason} — serving stale cache`,
      );
      return { kind: "meta", meta: stale, stale: true };
    }
    emit(
      run,
      "provider_gate",
      "warn",
      `${adapter.policy.provider} ${av.reason} until ${av.until.toISOString()} — requeued, no attempt consumed`,
    );
    return { kind: "final", outcome: requeue(av.until, `${adapter.policy.provider}_${av.reason}`) };
  }

  // Per-user daily cap: excess saves wait for tomorrow instead of failing.
  if (t.userId && t.stage === "fetch") {
    const n = await userEnrichmentCountToday(db, t.userId, t.jobId ?? null);
    if (n > config.pipeline.userDailyCap) {
      emit(
        run,
        "user_cap",
        "warn",
        `user is over the daily cap (${n}/${config.pipeline.userDailyCap}) — deferred to tomorrow`,
      );
      return { kind: "final", outcome: requeue(nextUtcMidnight(now), "user_daily_cap") };
    }
  }

  const lock = await lockPost(
    db,
    t.platform,
    t.contentId,
    addDays(now, adapter.policy.maxRetentionDays),
    t.stage === "refresh",
  );
  if (lock === "held") {
    emit(
      run,
      "single_flight",
      "info",
      "another worker is fetching this post — requeued 5s, no attempt consumed",
    );
    return { kind: "final", outcome: requeue(new Date(now.getTime() + 5000), "lock_held") };
  }
  emit(run, "single_flight", "ok", "lock acquired");
  return { kind: "need_fetch" };
}

export async function applyCachedAnalysis(
  ctx: PipelineContext,
  run: RunCtx,
  t: Target,
  a: AnalysisRow,
  meta: PostMeta | null,
): Promise<Outcome> {
  const { db, config } = ctx;
  let spots: SpotRow[] = a.spots ?? [];
  if (spots.length && a.category) {
    const fresh = await ctx.places.ensureFreshCoords(spots, t.contentId, (m) =>
      emit(run, "place_refresh", "warn", m),
    );
    spots = fresh.spots;
    if (fresh.changed) {
      await updateAnalysisSpots(
        db,
        t.platform,
        t.contentId,
        config.pipeline.promptVersion,
        config.pipeline.classifierModel,
        spots,
      );
      emit(run, "place_refresh", "ok", "coordinates re-resolved inside the 30-day window");
    }
  }
  const saveId = t.saveId;
  if (t.writeback && saveId) {
    await traced(
      run,
      "writeback",
      () =>
        finalizeSave(db, saveId, {
          category: a.category ?? "unsorted",
          confidence: a.confidence ?? 0,
          meta,
          spots,
        }),
      (r) => ({
        message: r.updated
          ? `save updated from analysis cache${r.located ? " (+location)" : ""}`
          : "save already finalized — nothing to do",
      }),
    );
  } else emit(run, "writeback", "skip", "dry run — no save to update");
  return { kind: "done", via: "analysis_cache" };
}

// ---------------------------------------------------------------------------
// fetch + normalize + cache write
// ---------------------------------------------------------------------------
export async function fetchAndCache(
  ctx: PipelineContext,
  run: RunCtx,
  t: Target,
  adapter: PlatformAdapter,
  prefetched?: RawResult | Error,
): Promise<Exclude<Prepared, { kind: "need_fetch" }>> {
  const { db } = ctx;
  const now = ctx.now();
  try {
    if (prefetched instanceof Error) throw prefetched;
    const raw: RawResult =
      prefetched ??
      (await traced(
        run,
        "fetch",
        () => adapter.fetchMeta(t.contentId, t.sourceUrl ? { sourceUrl: t.sourceUrl } : {}),
        (r) => ({
          message:
            r.status === "ok"
              ? `fetched via ${adapter.policy.provider}`
              : `provider says ${r.status}`,
        }),
      ));
    if (prefetched)
      emit(run, "fetch", "ok", `fetched via ${adapter.policy.provider} (batched call)`);

    if (raw.status !== "ok") {
      await writeNegative(db, {
        platform: t.platform,
        contentId: t.contentId,
        status: raw.status,
        provider: adapter.policy.provider,
        expiresAt: addHours(now, adapter.policy.negativeTtlHours),
        purgeAfter: addDays(now, adapter.policy.maxRetentionDays),
      });
      emit(
        run,
        "cache_write",
        "ok",
        `negative-cached ${raw.status} for ${adapter.policy.negativeTtlHours}h`,
      );
      return { kind: "final", outcome: { kind: "needs_review", reason: raw.status } };
    }

    let meta: PostMeta;
    try {
      meta = await traced(
        run,
        "normalize",
        () => Promise.resolve(adapter.normalize(raw, t.contentId)),
        (m) => ({
          message: `${m.mediaType}; text ${m.text?.length ?? 0} chars, ${m.hashtags.length} tags${
            m.location?.name ? ", tagged location" : ""
          }`,
        }),
      );
    } catch (e) {
      if (e instanceof SchemaDrift) {
        await writeDrift(db, {
          platform: t.platform,
          contentId: t.contentId,
          raw: e.raw ?? raw.payload,
          provider: adapter.policy.provider,
          purgeAfter: addDays(now, adapter.policy.maxRetentionDays),
        });
        emit(
          run,
          "schema_drift",
          "error",
          `${e.endpoint} missing ${e.missingField}; raw payload stored in post_cache.raw`,
          { meta: { kind: "schema_drift" } },
        );
        await ctx.health.alert(
          `schema_drift:${adapter.policy.provider}`,
          "schema_drift",
          `${adapter.policy.provider} response shape changed (${e.endpoint}: ${e.missingField}). Raw payload stored.`,
          60,
        );
        return { kind: "final", outcome: { kind: "needs_review", reason: "schema_drift" } };
      }
      throw e;
    }

    if (adapter.policy.mirrorThumbnails && meta.thumbnailUrl && ctx.storage) {
      try {
        const url = await traced(
          run,
          "thumbnail_mirror",
          () => mirrorThumbnail(ctx, meta),
          (u) => ({ message: `mirrored to storage (${u ? "ok" : "skipped"})` }),
        );
        if (url) meta.extras.mirroredThumbnail = url;
      } catch {
        /* soft fail: traced() already recorded the error */
      }
    }

    await traced(
      run,
      "cache_write",
      () =>
        writeOk(db, {
          platform: t.platform,
          contentId: t.contentId,
          meta,
          raw: raw.payload,
          contentHash: contentHash(meta),
          provider: raw.provider ?? adapter.policy.provider,
          expiresAt: addDays(now, adapter.policy.metaTtlDays),
          purgeAfter: addDays(now, adapter.policy.maxRetentionDays),
        }),
      () => ({
        message: `cached ${adapter.policy.metaTtlDays}d soft TTL / ${adapter.policy.maxRetentionDays}d retention`,
      }),
    );
    return { kind: "meta", meta, stale: false };
  } catch (e) {
    await releaseLock(db, t.platform, t.contentId).catch(() => undefined);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// classify via the ladder + place resolution + write-back
// ---------------------------------------------------------------------------
export async function classifyStep(
  ctx: PipelineContext,
  run: RunCtx,
  t: Target,
  adapter: PlatformAdapter,
  meta: PostMeta,
): Promise<Outcome> {
  const now = ctx.now();
  const result = await runLadder(run, meta, {
    classify: (e) => ctx.classifier.classify(e, t.contentId),
    ...(adapter.fetchComments
      ? {
          getComments: async () => {
            const hit = cachedComments(meta, adapter.policy.commentsTtlDays, now);
            if (hit) return hit;
            const fresh = await (
              adapter.fetchComments as NonNullable<typeof adapter.fetchComments>
            )(t.contentId, meta);
            await saveComments(ctx.db, t.platform, t.contentId, fresh);
            return fresh;
          },
        }
      : {}),
    canFrames: adapter.frames.length > 0,
    threshold: ctx.config.pipeline.confidenceThreshold,
  });

  if (result.kind === "resolved") {
    return resolveAndStore(ctx, run, t, meta, result.classification, result.rung);
  }

  if (result.kind === "needs_frames") {
    if (t.stage === "refresh") return { kind: "done", via: "refreshed" };
    const saveId = t.saveId;
    if (!t.writeback || !saveId) {
      emit(run, "frames_enqueue", "skip", "dry run — a frames job would be queued here");
      return { kind: "awaiting_frames" };
    }
    await traced(
      run,
      "frames_enqueue",
      () => enqueueFramesJob(ctx.db, saveId, t.platform, t.contentId),
      () => ({ message: "frames job queued" }),
    );
    return { kind: "awaiting_frames" };
  }

  if (t.stage === "refresh") return { kind: "done", via: "refreshed" };
  return { kind: "needs_review", reason: result.reason, meta };
}

export async function resolveAndStore(
  ctx: PipelineContext,
  run: RunCtx,
  t: Target,
  meta: PostMeta | null,
  c: Classification,
  rung: ResolvedBy,
): Promise<Outcome> {
  const { db, config } = ctx;
  let spots: SpotRow[] = c.spots;
  if (ctx.places.shouldResolve(c.category) && (spots.length || meta?.location?.name)) {
    spots = await traced(
      run,
      "place_resolve",
      () =>
        ctx.places.resolveSpots(spots, meta, t.contentId, (m) =>
          emit(run, "place_resolve", "warn", m),
        ),
      (s) => ({
        message: `${s.filter((x) => x.lat != null).length}/${s.length} spots resolved to coordinates`,
      }),
    );
  } else {
    emit(
      run,
      "place_resolve",
      "skip",
      c.spots.length ? `not resolved for ${c.category}` : "no named spots",
    );
  }

  // Analysis derived from a user's own device metadata is private to that save: caching it would let
  // one forged caption decide the category every other user gets for this post.
  if (t.metaSource === "device") {
    emit(
      run,
      "analysis_write",
      "skip",
      "device-sourced metadata is untrusted — analysis not shared",
    );
  } else
    await traced(
      run,
      "analysis_write",
      () =>
        upsertAnalysis(db, {
          platform: t.platform,
          contentId: t.contentId,
          promptVersion: config.pipeline.promptVersion,
          model: config.pipeline.classifierModel,
          category: c.category,
          confidence: c.confidence,
          spots,
          resolvedBy: rung,
        }),
      () => ({
        message: `cached analysis (${c.category} @ ${Math.round(c.confidence * 100)}%, resolved_by=${rung})`,
        meta: { resolved_by: rung },
      }),
    );

  const saveId = t.saveId;
  if (t.writeback && saveId) {
    await traced(
      run,
      "writeback",
      () =>
        finalizeSave(db, saveId, { category: c.category, confidence: c.confidence, meta, spots }),
      (r) => ({
        message: r.updated
          ? `save updated → ${c.category}${r.located ? " (+location)" : ""}`
          : "save already finalized — nothing to do",
      }),
    );
  } else {
    emit(
      run,
      "writeback",
      "skip",
      t.stage === "refresh" ? "refresh — saves untouched" : "dry run — no save to update",
    );
  }
  return { kind: "done", via: "classified" };
}

// ---------------------------------------------------------------------------
// refresh (YouTube 30-day rule): refetch, reset retention, reclassify only if needed
// ---------------------------------------------------------------------------
async function runRefresh(
  ctx: PipelineContext,
  run: RunCtx,
  t: Target,
  prefetched?: RawResult | Error,
): Promise<Outcome> {
  const adapter = ctx.registry.byId(t.platform);
  const prev = await getPostCache(ctx.db, t.platform, t.contentId);
  const p = await prepare(ctx, run, t);
  if (p.kind === "meta") return { kind: "done", via: "refreshed" };
  if (p.kind === "final") return p.outcome;
  const f = await fetchAndCache(ctx, run, t, adapter, prefetched);
  if (f.kind === "final") return f.outcome;
  const hash = contentHash(f.meta);
  const analysis = await getAnalysis(
    ctx.db,
    t.platform,
    t.contentId,
    ctx.config.pipeline.promptVersion,
    ctx.config.pipeline.classifierModel,
  );
  if (hash !== prev?.content_hash || !analysis) {
    emit(
      run,
      "refresh",
      "info",
      analysis
        ? "content changed — reclassifying"
        : "no analysis for current prompt version — classifying",
    );
    return classifyStep(ctx, run, t, adapter, f.meta);
  }
  emit(run, "refresh", "ok", "content unchanged; retention extended, no model call");
  return { kind: "done", via: "refreshed" };
}

// ---------------------------------------------------------------------------
// run one target end to end; every failure becomes a typed Outcome
// ---------------------------------------------------------------------------
export async function runTarget(
  ctx: PipelineContext,
  run: RunCtx,
  t: Target,
  opts: { prepared?: Prepared; prefetched?: RawResult | Error } = {},
): Promise<Outcome> {
  try {
    if (t.stage === "refresh") return await runRefresh(ctx, run, t, opts.prefetched);
    const adapter = ctx.registry.byId(t.platform);
    let p = opts.prepared ?? (await prepare(ctx, run, t));
    if (p.kind === "need_fetch") p = await fetchAndCache(ctx, run, t, adapter, opts.prefetched);
    if (p.kind === "final") return p.outcome;
    return await classifyStep(ctx, run, t, adapter, p.meta);
  } catch (e) {
    return outcomeFromError(ctx, run, e);
  }
}

export function outcomeFromError(ctx: PipelineContext, run: RunCtx, e: unknown): Outcome {
  const msg = errMessage(e);
  if (e instanceof ProviderUnavailable) {
    emit(run, "provider_gate", "warn", `${msg} — requeued, no attempt consumed`);
    return requeue(e.until, `${e.provider}_${e.reason}`);
  }
  if (e instanceof ProviderError) {
    emit(run, "error", "error", `provider error: ${msg}`, {
      meta: { kind: e.kind, http: e.httpStatus ?? null },
    });
    switch (e.kind) {
      case "quota":
        return requeue(nextPacificMidnight(ctx.now()), "quota_exceeded");
      case "auth":
      case "budget":
        return requeue(new Date(ctx.now().getTime() + 5 * 60_000), `provider_${e.kind}`);
      case "blocked":
        return { kind: "needs_review", reason: "blocked" };
      default:
        return {
          kind: "retry",
          error: msg,
          ...(e.retryAfterMs !== undefined ? { retryAfterMs: e.retryAfterMs } : {}),
        };
    }
  }
  if (e instanceof ClassificationInvalid) {
    emit(run, "error", "error", msg);
    return { kind: "needs_review", reason: "invalid_model_output" };
  }
  emit(run, "error", "error", `unexpected: ${msg}`);
  return { kind: "retry", error: msg };
}

// ---------------------------------------------------------------------------
// apply an outcome to the job (and save) row
// ---------------------------------------------------------------------------
export interface JobRef {
  id: number;
  save_id: string;
  attempts: number;
  stage: string;
}

export async function applyOutcome(
  ctx: PipelineContext,
  run: RunCtx,
  job: JobRef,
  o: Outcome,
): Promise<"done" | "queued" | "dead"> {
  const { db, config } = ctx;
  switch (o.kind) {
    case "done":
      await markJobDone(db, job.id, null);
      emit(run, "job", "ok", `done (${o.via})`);
      return "done";
    case "awaiting_frames":
      await markJobDone(db, job.id, null);
      emit(run, "job", "ok", "fetch stage done; waiting on the frames stage");
      return "done";
    case "needs_review":
      await markNeedsReview(db, job.save_id, o.reason, o.meta);
      await markJobDone(db, job.id, o.reason);
      emit(run, "job", "warn", `needs_review (${o.reason})`);
      return "done";
    case "requeue":
      await requeueJob(
        db,
        job.id,
        o.at,
        o.reason,
        o.consumeAttempt ? job.attempts : Math.max(job.attempts - 1, 0),
      );
      emit(run, "job", "info", `requeued until ${o.at.toISOString()} (${o.reason})`);
      return "queued";
    case "retry": {
      if (job.attempts >= config.pipeline.maxAttempts) {
        await killJob(db, job.id, o.error);
        await markNeedsReview(db, job.save_id, "dead_job");
        emit(run, "job", "error", `DEAD after ${job.attempts} attempts: ${o.error}`);
        return "dead";
      }
      const at = new Date(ctx.now().getTime() + backoffMs(job.attempts, o.retryAfterMs));
      await retryJob(db, job.id, at, o.error);
      emit(
        run,
        "job",
        "warn",
        `retry ${job.attempts}/${config.pipeline.maxAttempts} at ${at.toISOString()}: ${o.error}`,
      );
      return "queued";
    }
  }
}
