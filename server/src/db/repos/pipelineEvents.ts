import type { Queryable, Row } from "../client.ts";
import { json } from "../client.ts";

export type EventStatus = "ok" | "error" | "skip" | "info" | "warn";

export interface EventInput {
  runId: string;
  jobId: number | null;
  saveId: string | null;
  platform: string | null;
  contentId: string | null;
  step: string;
  status: EventStatus;
  message: string;
  durationMs: number | null;
  meta: Record<string, unknown> | null;
}

export async function insertEvent(q: Queryable, e: EventInput): Promise<void> {
  await q.query(
    `insert into pipeline_events (run_id, job_id, save_id, platform, content_id, step, status, message, duration_ms, meta)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [
      e.runId,
      e.jobId,
      e.saveId,
      e.platform,
      e.contentId,
      e.step,
      e.status,
      e.message,
      e.durationMs,
      e.meta ? json(e.meta) : null,
    ],
  );
}

export interface RunSummary extends Row {
  run_id: string;
  started_at: Date;
  job_id: number | null;
  save_id: string | null;
  platform: string | null;
  content_id: string | null;
  steps: number;
  errors: number;
  warnings: number;
  last_step: string | null;
}

export async function listRuns(
  q: Queryable,
  f: {
    limit: number;
    onlyErrors?: boolean;
    platform?: string;
    jobId?: number;
    saveId?: string;
    contentIdLike?: string;
  },
): Promise<RunSummary[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (cond: string, v: unknown) => {
    params.push(v);
    where.push(cond.replace("?", `$${params.length}`));
  };
  if (f.onlyErrors) where.push("errors > 0");
  if (f.platform) add("platform = ?", f.platform);
  if (f.jobId !== undefined) add("job_id = ?", f.jobId);
  if (f.saveId) add("save_id = ?", f.saveId);
  if (f.contentIdLike) add("content_id ilike ? escape '\\'", `%${f.contentIdLike}%`);
  params.push(f.limit);
  const r = await q.query<RunSummary>(
    `select run_id, started_at, job_id, save_id, platform, content_id, steps, errors, warnings, last_step
       from v_pipeline_runs ${where.length ? `where ${where.join(" and ")}` : ""}
      order by started_at desc limit $${params.length}`,
    params,
  );
  return r.rows;
}

export async function runEvents(q: Queryable, runId: string): Promise<Row[]> {
  const r = await q.query("select * from pipeline_events where run_id = $1 order by id", [runId]);
  return r.rows;
}

export async function listEvents(
  q: Queryable,
  f: { limit: number; status?: string; step?: string; beforeId?: number },
): Promise<Row[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (cond: string, v: unknown) => {
    params.push(v);
    where.push(cond.replace("?", `$${params.length}`));
  };
  if (f.status) add("status = ?", f.status);
  if (f.step) add("step = ?", f.step);
  if (f.beforeId !== undefined) add("id < ?", f.beforeId);
  params.push(f.limit);
  const r = await q.query(
    `select * from pipeline_events ${where.length ? `where ${where.join(" and ")}` : ""}
      order by id desc limit $${params.length}`,
    params,
  );
  return r.rows;
}
