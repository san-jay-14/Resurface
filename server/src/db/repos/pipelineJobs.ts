import type { Queryable, Row } from "../client.ts";
import { one } from "../client.ts";

export interface JobRow extends Row {
  id: number;
  save_id: string;
  platform: string;
  content_id: string;
  stage: "fetch" | "comments" | "frames" | "classify" | "refresh";
  status: "queued" | "running" | "done" | "dead";
  attempts: number;
  next_run_at: Date;
  locked_at: Date | null;
  last_error: string | null;
  created_at: Date;
  finished_at: Date | null;
}

/** Atomically claim due jobs (`for update skip locked`): concurrent drains never double-process. */
export async function claimJobs(
  q: Queryable,
  batchSize: number,
  stages: readonly string[],
): Promise<JobRow[]> {
  const r = await q.query<JobRow>("select * from claim_jobs($1, $2::text[])", [batchSize, stages]);
  return r.rows;
}

export interface SaveBasics extends Row {
  id: string;
  user_id: string;
  source_url: string | null;
}

export async function loadSaveBasics(q: Queryable, ids: readonly string[]): Promise<SaveBasics[]> {
  if (ids.length === 0) return [];
  const r = await q.query<SaveBasics>(
    "select id, user_id, source_url from saves where id = any($1::uuid[])",
    [ids],
  );
  return r.rows;
}

/** Saves of just-claimed jobs move queued -> processing (drives the app's "Sorting" state). */
export async function markSavesProcessing(q: Queryable, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await q.query(
    "update saves set enrichment_status = 'processing' where id = any($1::uuid[]) and enrichment_status = 'queued'",
    [ids],
  );
}

export async function userEnrichmentCountToday(
  q: Queryable,
  userId: string,
  uptoJobId: number | null,
): Promise<number> {
  const r = await one<{ n: number }>(q, "select user_enrichment_count_today($1, $2) as n", [
    userId,
    uptoJobId,
  ]);
  return r?.n ?? 0;
}

export async function markJobDone(
  q: Queryable,
  id: number,
  lastError: string | null,
): Promise<void> {
  await q.query(
    "update enrichment_jobs set status = 'done', last_error = $2, locked_at = null, finished_at = now() where id = $1",
    [id, lastError],
  );
}

export async function requeueJob(
  q: Queryable,
  id: number,
  at: Date,
  reason: string,
  attempts: number,
): Promise<void> {
  await q.query(
    `update enrichment_jobs set status = 'queued', next_run_at = $2, locked_at = null, last_error = $3,
            attempts = $4 where id = $1`,
    [id, at, reason, attempts],
  );
}

export async function retryJob(q: Queryable, id: number, at: Date, error: string): Promise<void> {
  await q.query(
    "update enrichment_jobs set status = 'queued', next_run_at = $2, locked_at = null, last_error = $3 where id = $1",
    [id, at, error],
  );
}

export async function killJob(q: Queryable, id: number, error: string): Promise<void> {
  await q.query(
    "update enrichment_jobs set status = 'dead', last_error = $2, locked_at = null, finished_at = now() where id = $1",
    [id, error],
  );
}

export async function enqueueFetchJob(
  q: Queryable,
  saveId: string,
  platform: string,
  contentId: string,
): Promise<void> {
  await q.query(
    `insert into enrichment_jobs (save_id, platform, content_id, stage) values ($1, $2, $3, 'fetch')
     on conflict (save_id, stage) do nothing`,
    [saveId, platform, contentId],
  );
}

/** Hand a save to the frames stage (re-arms a previously finished/dead frames job). */
export async function enqueueFramesJob(
  q: Queryable,
  saveId: string,
  platform: string,
  contentId: string,
): Promise<void> {
  await q.query(
    `insert into enrichment_jobs (save_id, platform, content_id, stage, status, attempts, next_run_at)
     values ($1, $2, $3, 'frames', 'queued', 0, now())
     on conflict (save_id, stage) do update set
       status = 'queued', attempts = 0, next_run_at = now(), last_error = null, finished_at = null`,
    [saveId, platform, contentId],
  );
}

export async function reapStuckJobs(q: Queryable): Promise<number> {
  const r = await one<{ n: number }>(q, "select reap_stuck_jobs() as n");
  return r?.n ?? 0;
}

export async function enqueueYoutubeRefresh(q: Queryable): Promise<number> {
  const r = await one<{ n: number }>(q, "select enqueue_youtube_refresh() as n");
  return r?.n ?? 0;
}

export async function countDeadJobs(q: Queryable): Promise<number> {
  const r = await one<{ n: number }>(
    q,
    "select count(*)::int as n from enrichment_jobs where status = 'dead'",
  );
  return r?.n ?? 0;
}

/** The soonest time any queued job becomes due (null when the queue is empty). */
export async function nextDueAt(q: Queryable): Promise<Date | null> {
  const r = await one<{ at: Date | null }>(
    q,
    "select min(next_run_at) as at from enrichment_jobs where status = 'queued'",
  );
  return r?.at ?? null;
}

// ---- admin ------------------------------------------------------------------

export async function listJobs(
  q: Queryable,
  filter: { status?: string; stage?: string; limit: number },
): Promise<JobRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    params.push(filter.status);
    where.push(`status = $${params.length}`);
  }
  if (filter.stage) {
    params.push(filter.stage);
    where.push(`stage = $${params.length}`);
  }
  params.push(filter.limit);
  const r = await q.query<JobRow>(
    `select * from enrichment_jobs ${where.length ? `where ${where.join(" and ")}` : ""}
      order by id desc limit $${params.length}`,
    params,
  );
  return r.rows;
}

/** Re-arm dead jobs (all, or one) and send their saves back to the queue. */
export async function retryDeadJobs(
  db: { tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> },
  id?: number,
): Promise<number> {
  return db.tx(async (q) => {
    const dead = await q.query<{ id: number; save_id: string }>(
      `update enrichment_jobs set status = 'queued', attempts = 0, next_run_at = now(), last_error = null,
              finished_at = null, locked_at = null
        where status = 'dead' ${id === undefined ? "" : "and id = $1"}
        returning id, save_id`,
      id === undefined ? [] : [id],
    );
    if (dead.rows.length) {
      await q.query(
        `update saves set enrichment_status = 'queued', enrichment_reason = null, status = 'pending'
          where id = any($1::uuid[])`,
        [dead.rows.map((j) => j.save_id)],
      );
    }
    return dead.rows.length;
  });
}
