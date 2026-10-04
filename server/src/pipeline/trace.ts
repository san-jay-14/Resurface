import { randomUUID } from "node:crypto";
import type { Queryable } from "../db/client.ts";
import { type EventStatus, insertEvent } from "../db/repos/pipelineEvents.ts";
import type { Logger } from "../logger.ts";
import { errorMessage } from "../util.ts";

/**
 * Step-level tracing. Every pipeline step writes a pipeline_events row (rendered by the admin
 * dashboard) and a structured log line. Tracing must never break the pipeline, so writes are
 * best-effort and collected in `pending` until flush(). NEVER pass captions or comments here:
 * log ids, status, lengths and timings only.
 */
export type { EventStatus };

export interface RunCtx {
  db: Queryable;
  log: Logger;
  runId: string;
  jobId?: number | null;
  saveId?: string | null;
  platform?: string;
  contentId?: string;
  pending: Promise<unknown>[];
}

export function newRun(
  base: { db: Queryable; log: Logger },
  init: Partial<Pick<RunCtx, "jobId" | "saveId" | "platform" | "contentId">> = {},
): RunCtx {
  return { ...base, runId: randomUUID(), pending: [], ...init };
}

/** Strip API keys / bearer tokens that can leak through fetch error messages. */
export function redact(s: string): string {
  return s
    .replace(/([?&](?:key|api_key|access_key|token)=)[^&\s"']+/gi, "$1REDACTED")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1REDACTED")
    .slice(0, 500);
}

export const errMessage = (e: unknown): string => redact(errorMessage(e));

export function emit(
  ctx: RunCtx,
  step: string,
  status: EventStatus,
  message: string,
  extra: { durationMs?: number; meta?: Record<string, unknown> } = {},
): void {
  ctx.log.info(
    {
      step,
      status,
      run: ctx.runId,
      job: ctx.jobId ?? null,
      save: ctx.saveId ?? null,
      platform: ctx.platform ?? null,
      contentId: ctx.contentId ?? null,
      ms: extra.durationMs ?? null,
    },
    redact(message),
  );
  const write = insertEvent(ctx.db, {
    runId: ctx.runId,
    jobId: ctx.jobId ?? null,
    saveId: ctx.saveId ?? null,
    platform: ctx.platform ?? null,
    contentId: ctx.contentId ?? null,
    step,
    status,
    message: redact(message),
    durationMs: extra.durationMs ?? null,
    meta: extra.meta ?? null,
  }).then(
    () => undefined,
    () => undefined,
  );
  ctx.pending.push(write);
}

/** Run a step, emitting ok/error with duration. Errors are re-thrown. */
export async function traced<T>(
  ctx: RunCtx,
  step: string,
  fn: () => Promise<T>,
  describe?: (r: T) => { message: string; meta?: Record<string, unknown> },
): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await fn();
    const d = describe?.(r) ?? { message: "ok" };
    emit(ctx, step, "ok", d.message, {
      durationMs: Date.now() - t0,
      ...(d.meta ? { meta: d.meta } : {}),
    });
    return r;
  } catch (e) {
    emit(ctx, step, "error", errMessage(e), { durationMs: Date.now() - t0 });
    throw e;
  }
}

export async function flush(ctx: RunCtx): Promise<void> {
  await Promise.allSettled(ctx.pending.splice(0));
}
