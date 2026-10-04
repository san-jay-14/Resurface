import { claimTask, ensureTask, finishTask } from "../db/repos/scheduler.ts";
import type { PipelineContext } from "../pipeline/context.ts";
import { errMessage } from "../pipeline/trace.ts";
import { type Schedule, firstRun, nextRun } from "./schedule.ts";

/**
 * Durable scheduler (replaces pg_cron). Task DEFINITIONS live in code; per-task STATE (next run,
 * lock, last result) lives in `scheduled_tasks`. An external pinger calls POST /internal/tick; each
 * tick runs whatever is due. Safe to call concurrently: claims are atomic row updates.
 */
export interface TaskDef {
  name: string;
  schedule: Schedule;
  /** Returns a short summary for the log. Throwing marks the run failed; the task still reschedules. */
  run(ctx: PipelineContext): Promise<string | void>;
}

export interface TaskResult {
  name: string;
  status: "ok" | "error" | "skipped";
  detail?: string;
  ms?: number;
}

const LOCK_MS = 10 * 60_000;

export async function runDueTasks(
  ctx: PipelineContext,
  tasks: readonly TaskDef[],
  only?: readonly string[],
): Promise<TaskResult[]> {
  const results: TaskResult[] = [];
  for (const task of tasks) {
    if (only && !only.includes(task.name)) continue;
    const now = ctx.now();
    await ensureTask(ctx.db, task.name, firstRun(task.schedule, now));
    if (!(await claimTask(ctx.db, task.name, now, LOCK_MS))) {
      results.push({ name: task.name, status: "skipped" });
      continue;
    }
    const t0 = Date.now();
    try {
      const detail = await task.run(ctx);
      await finishTask(ctx.db, task.name, {
        now,
        nextRunAt: nextRun(task.schedule, now),
        status: "ok",
        error: null,
      });
      results.push({
        name: task.name,
        status: "ok",
        ms: Date.now() - t0,
        ...(detail ? { detail } : {}),
      });
      ctx.log.info({ task: task.name, ms: Date.now() - t0, detail }, "task ok");
    } catch (err) {
      const message = errMessage(err);
      await finishTask(ctx.db, task.name, {
        now,
        nextRunAt: nextRun(task.schedule, now),
        status: "error",
        error: message,
      }).catch(() => undefined);
      results.push({ name: task.name, status: "error", detail: message, ms: Date.now() - t0 });
      ctx.log.error({ task: task.name, err: message }, "task failed");
    }
  }
  return results;
}
