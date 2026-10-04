import type { RawResult } from "../adapters/types.ts";
import {
  type JobRow,
  claimJobs,
  countDeadJobs,
  loadSaveBasics,
  markSavesProcessing,
} from "../db/repos/pipelineJobs.ts";
import { releaseLock } from "../db/repos/pipelineCache.ts";
import { errorMessage, pool } from "../util.ts";
import type { PipelineContext } from "./context.ts";
import { processFramesJob } from "./frames.ts";
import {
  type Outcome,
  type Prepared,
  type Target,
  applyOutcome,
  outcomeFromError,
  prepare,
  runTarget,
} from "./process.ts";
import { emit, flush, newRun, type RunCtx } from "./trace.ts";

/**
 * One drain tick: claim <= 20 jobs, run them with concurrency 5, apply outcomes. One invocation per
 * tick bounds provider traffic without a shared limiter. YouTube fetch jobs in the same tick are
 * grouped into videos.list calls of up to 50 ids (adapter.fetchMetaBatch), so ten Shorts queued
 * together cost one call.
 */
export interface DrainSummary {
  claimed: number;
  done: number;
  queued: number;
  dead: number;
  batchedCalls: number;
  runId: string;
}

const STAGES = ["fetch", "refresh", "frames"] as const;

interface Slot {
  job: JobRow;
  run: RunCtx;
  target: Target;
  prepared?: Prepared;
  outcome?: Outcome;
}

export async function drainOnce(ctx: PipelineContext): Promise<DrainSummary> {
  const { db, config } = ctx;
  const started = Date.now();
  const drainRun = newRun(ctx);
  const summary: DrainSummary = {
    claimed: 0,
    done: 0,
    queued: 0,
    dead: 0,
    batchedCalls: 0,
    runId: drainRun.runId,
  };

  const jobs = await claimJobs(db, config.pipeline.drainBatchSize, STAGES);
  summary.claimed = jobs.length;
  if (!jobs.length) {
    await maybeAlertDead(ctx);
    return summary;
  }

  const saveIds = jobs.map((j) => j.save_id);
  await markSavesProcessing(db, saveIds);
  const saves = new Map((await loadSaveBasics(db, saveIds)).map((s) => [s.id, s]));

  const slots: Slot[] = jobs.map((job) => {
    const save = saves.get(job.save_id);
    const run = newRun(ctx, {
      jobId: job.id,
      saveId: job.save_id,
      platform: job.platform,
      contentId: job.content_id,
    });
    emit(run, "job_start", "info", `${job.stage} job ${job.id}, attempt ${job.attempts}`);
    return {
      job,
      run,
      target: {
        platform: job.platform,
        contentId: job.content_id,
        sourceUrl: save?.source_url ?? null,
        saveId: job.save_id,
        userId: save?.user_id ?? null,
        jobId: job.id,
        attempts: job.attempts,
        stage: job.stage === "refresh" ? "refresh" : "fetch",
        writeback: job.stage !== "refresh",
      },
    };
  });

  const budgetMs = config.pipeline.drainBudgetMs;
  const outOfTime = () => Date.now() - started > budgetMs;
  const handBack = (s: Slot): void => {
    s.outcome = {
      kind: "requeue",
      at: ctx.now(),
      consumeAttempt: false,
      reason: "drain_time_budget",
    };
  };
  const pipelineSlots = slots.filter((s) => s.job.stage !== "frames");

  // Phase 1 — prepare (caches, gates, single-flight lock)
  await pool(pipelineSlots, config.pipeline.drainConcurrency, async (s) => {
    if (s.target.stage === "refresh") return;
    if (outOfTime()) return handBack(s);
    try {
      const p = await prepare(ctx, s.run, s.target);
      if (p.kind === "final") s.outcome = p.outcome;
      else s.prepared = p;
    } catch (e) {
      s.outcome = outcomeFromError(ctx, s.run, e);
    }
  });

  // Phase 2 — batch the provider calls for adapters that support it
  const prefetched = new Map<string, RawResult | Error>(); // key: platform|contentId
  const wanting = new Map<string, Slot[]>();
  for (const s of pipelineSlots) {
    if (s.outcome || s.prepared?.kind !== "need_fetch") continue;
    const adapter = ctx.registry.byId(s.target.platform);
    if (!adapter.fetchMetaBatch) continue;
    wanting.set(adapter.id, [...(wanting.get(adapter.id) ?? []), s]);
  }
  for (const [platform, group] of wanting) {
    const adapter = ctx.registry.byId(platform);
    if (!adapter.fetchMetaBatch) continue;
    const ids = [...new Set(group.map((s) => s.target.contentId))];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const t0 = Date.now();
      try {
        const map = (await adapter.fetchMetaBatch?.(chunk)) ?? new Map<string, RawResult>();
        for (const id of chunk)
          prefetched.set(`${platform}|${id}`, map.get(id) ?? { status: "not_found" });
        summary.batchedCalls++;
        emit(
          drainRun,
          "batch_fetch",
          "ok",
          `${adapter.policy.provider}: ${chunk.length} ids in 1 call`,
          {
            durationMs: Date.now() - t0,
            meta: { ids: chunk.length },
          },
        );
      } catch (e) {
        for (const id of chunk)
          prefetched.set(`${platform}|${id}`, e instanceof Error ? e : new Error(String(e)));
        emit(
          drainRun,
          "batch_fetch",
          "error",
          `${adapter.policy.provider}: batch of ${chunk.length} failed: ${errorMessage(e)}`,
          { durationMs: Date.now() - t0 },
        );
      }
    }
  }

  // Phase 3 — fetch (if needed), classify, write back; frames jobs run their own stage
  await pool(slots, config.pipeline.drainConcurrency, async (s) => {
    if (!s.outcome) {
      if (outOfTime()) {
        // Release any single-flight lock we hold before handing the job back.
        if (s.prepared?.kind === "need_fetch") {
          await releaseLock(db, s.target.platform, s.target.contentId).catch(() => undefined);
        }
        handBack(s);
      } else if (s.job.stage === "frames") {
        s.outcome = await processFramesJob(ctx, s.run, s.job);
      } else {
        s.outcome = await runTarget(ctx, s.run, s.target, {
          ...(s.prepared ? { prepared: s.prepared } : {}),
          ...(prefetched.has(`${s.target.platform}|${s.target.contentId}`)
            ? {
                prefetched: prefetched.get(`${s.target.platform}|${s.target.contentId}`) as
                  RawResult | Error,
              }
            : {}),
        });
      }
    }
    try {
      const r = await applyOutcome(ctx, s.run, s.job, s.outcome as Outcome);
      summary[r]++;
    } catch (e) {
      emit(
        s.run,
        "job",
        "error",
        `could not record outcome: ${errorMessage(e)} — reaper will requeue`,
      );
    }
    await flush(s.run);
  });

  emit(
    drainRun,
    "drain",
    "ok",
    `claimed ${summary.claimed}: ${summary.done} done, ${summary.queued} requeued, ${summary.dead} dead; ${summary.batchedCalls} batched provider call(s)`,
    { durationMs: Date.now() - started, meta: { ...summary } },
  );
  await flush(drainRun);
  await maybeAlertDead(ctx);
  return summary;
}

async function maybeAlertDead(ctx: PipelineContext): Promise<void> {
  const dead = await countDeadJobs(ctx.db);
  if (dead >= ctx.config.pipeline.deadJobsAlertThreshold) {
    await ctx.health.alert(
      "dead_jobs",
      "dead_jobs_high",
      `${dead} jobs are dead-lettered (threshold ${ctx.config.pipeline.deadJobsAlertThreshold}).`,
      180,
    );
  }
}
