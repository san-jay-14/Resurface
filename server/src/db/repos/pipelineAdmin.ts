import type { Queryable, Row } from "../client.ts";
import { one } from "../client.ts";
import { listTasks } from "./scheduler.ts";

/** Read models for the admin dashboard. */
const zeroed = (keys: string[]): Record<string, number> =>
  Object.fromEntries(keys.map((k) => [k, 0]));

export async function overview(q: Queryable): Promise<Row> {
  const [jobs, saves, events, providers, flags, hit, rungs, ttc, cost, alerts, tasks] =
    await Promise.all([
      q.query<{ status: string; n: number }>(
        "select status, count(*)::int as n from enrichment_jobs group by status",
      ),
      q.query<{ status: string; n: number }>(
        `select coalesce(enrichment_status, 'none') as status, count(*)::int as n
         from saves where enrichment_status is not null group by 1`,
      ),
      q.query<{ status: string; n: number }>(
        `select status, count(*)::int as n from pipeline_events
        where created_at > now() - interval '24 hours' group by status`,
      ),
      q.query("select * from v_breaker_state order by provider"),
      q.query("select key, enabled from feature_flags order by key"),
      q.query("select * from v_cache_hit_rates"),
      q.query("select * from v_rung_resolution"),
      one(q, "select * from v_time_to_categorized"),
      one(q, "select * from v_cost_per_resolved_save"),
      q.query("select * from pipeline_alerts order by id desc limit 10"),
      listTasks(q),
    ]);

  const fold = (rows: { status: string; n: number }[], keys: string[]) => {
    const out = zeroed(keys);
    for (const r of rows) out[r.status] = r.n;
    return out;
  };
  return {
    jobs: fold(jobs.rows, ["queued", "running", "done", "dead"]),
    saves: fold(saves.rows, ["queued", "processing", "done", "needs_review"]),
    events24h: fold(events.rows, ["ok", "error", "warn"]),
    providers: providers.rows,
    flags: flags.rows,
    metrics: {
      cacheHitRates: hit.rows,
      rungs: rungs.rows,
      timeToCategorized: ttc,
      cost,
    },
    alerts: alerts.rows,
    tasks,
  };
}

export async function listProviderCalls(q: Queryable, limit: number): Promise<Row[]> {
  const r = await q.query("select * from provider_calls order by id desc limit $1", [limit]);
  return r.rows;
}

export async function listDeadLetter(q: Queryable, limit = 200): Promise<Row[]> {
  const r = await q.query("select * from v_dead_letter order by id desc limit $1", [limit]);
  return r.rows;
}
