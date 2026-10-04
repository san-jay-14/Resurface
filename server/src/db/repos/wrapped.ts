import type { WrappedCopy, WrappedSaveRow, WrappedStats } from "../../domain/wrapped.ts";
import type { Queryable, Row } from "../client.ts";
import { json, one } from "../client.ts";

export interface WrappedRow extends Row {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  stats_snapshot: WrappedStats;
  copy: WrappedCopy;
  created_at: Date;
}

const COLS = "id, user_id, period_start, period_end, stats_snapshot, copy, created_at";

export async function savesForWrapped(
  q: Queryable,
  userId: string,
  since: Date,
): Promise<WrappedSaveRow[]> {
  const r = await q.query<WrappedSaveRow>(
    `select category, source_platform, acted_on, created_at, title, ai_description
       from saves where user_id = $1 and created_at >= $2 and archived = false
      order by created_at limit 5000`,
    [userId, since],
  );
  return r.rows;
}

export async function listWrapped(q: Queryable, userId: string): Promise<WrappedRow[]> {
  const r = await q.query<WrappedRow>(
    `select ${COLS} from wrapped_history where user_id = $1 order by created_at desc`,
    [userId],
  );
  return r.rows;
}

export function getWrapped(q: Queryable, userId: string, id: string): Promise<WrappedRow | null> {
  return one<WrappedRow>(q, `select ${COLS} from wrapped_history where id = $1 and user_id = $2`, [
    id,
    userId,
  ]);
}

export async function insertWrapped(
  q: Queryable,
  userId: string,
  p: { periodStart: string; stats: WrappedStats; copy: WrappedCopy },
): Promise<WrappedRow> {
  const r = await one<WrappedRow>(
    q,
    `insert into wrapped_history (user_id, period_start, stats_snapshot, copy)
     values ($1, $2, $3::jsonb, $4::jsonb) returning ${COLS}`,
    [userId, p.periodStart, json(p.stats), json(p.copy)],
  );
  if (!r) throw new Error("insert returned no row");
  return r;
}

/** Wrapped cards generated since `since` (cost guard) and the newest one for a period (idempotency). */
export async function recentWrapped(
  q: Queryable,
  userId: string,
  since: Date,
): Promise<Pick<WrappedRow, "id" | "period_start" | "created_at">[]> {
  const r = await q.query<Pick<WrappedRow, "id" | "period_start" | "created_at">>(
    "select id, period_start, created_at from wrapped_history where user_id = $1 and created_at >= $2 order by created_at desc",
    [userId, since],
  );
  return r.rows;
}
