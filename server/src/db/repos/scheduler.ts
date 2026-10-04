import type { Queryable, Row } from "../client.ts";
import { one } from "../client.ts";

export interface TaskRow extends Row {
  name: string;
  next_run_at: Date;
  last_run_at: Date | null;
  last_status: string | null;
  last_error: string | null;
  locked_until: Date | null;
  run_count: number;
}

/** Make sure a row exists for the task (idempotent). */
export async function ensureTask(q: Queryable, name: string, firstRunAt: Date): Promise<void> {
  await q.query(
    "insert into scheduled_tasks (name, next_run_at) values ($1, $2) on conflict (name) do nothing",
    [name, firstRunAt],
  );
}

/**
 * Atomically claim a due task. Returns false when it is not due or another runner holds the lock,
 * so overlapping ticks never run the same task twice. The lock expires on its own if a run crashes.
 */
export async function claimTask(
  q: Queryable,
  name: string,
  now: Date,
  lockMs: number,
): Promise<boolean> {
  const r = await one(
    q,
    `update scheduled_tasks
        set locked_until = $2::timestamptz + make_interval(secs => $3)
      where name = $1 and next_run_at <= $2 and (locked_until is null or locked_until < $2)
      returning name`,
    [name, now, lockMs / 1000],
  );
  return r !== null;
}

export async function finishTask(
  q: Queryable,
  name: string,
  p: { now: Date; nextRunAt: Date; status: "ok" | "error"; error: string | null },
): Promise<void> {
  await q.query(
    `update scheduled_tasks
        set next_run_at = $2, last_run_at = $3, last_status = $4, last_error = $5,
            locked_until = null, run_count = run_count + 1
      where name = $1`,
    [name, p.nextRunAt, p.now, p.status, p.error],
  );
}

export async function listTasks(q: Queryable): Promise<TaskRow[]> {
  const r = await q.query<TaskRow>("select * from scheduled_tasks order by name");
  return r.rows;
}
