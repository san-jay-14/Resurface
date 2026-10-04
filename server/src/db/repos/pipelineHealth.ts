import type { Queryable, Row } from "../client.ts";
import { one } from "../client.ts";

export interface HealthRow extends Row {
  provider: string;
  consecutive_failures: number;
  open_until: Date | null;
  spend_today: string; // numeric
  spend_day: string; // date 'YYYY-MM-DD'
  last_error: string | null;
}

export function getHealth(q: Queryable, provider: string): Promise<HealthRow | null> {
  return one<HealthRow>(
    q,
    `select provider, consecutive_failures, open_until, spend_today::text as spend_today,
            spend_day, last_error from provider_health where provider = $1`,
    [provider],
  );
}

export async function recordCall(
  q: Queryable,
  c: {
    provider: string;
    endpoint: string;
    platform: string | null;
    contentId: string | null;
    statusCode: number | null;
    latencyMs: number;
    cost: number;
  },
): Promise<void> {
  await q.query(
    `insert into provider_calls (provider, endpoint, platform, content_id, status_code, latency_ms, est_cost)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [c.provider, c.endpoint, c.platform, c.contentId, c.statusCode, c.latencyMs, c.cost],
  );
}

export interface BreakerResult {
  opened: boolean;
  open_until: string | null;
  consecutive_failures: number;
}

/** Atomic breaker + spend bookkeeping (see provider_record in the migration). */
export async function providerRecord(
  q: Queryable,
  p: {
    provider: string;
    ok: boolean;
    cost: number;
    error: string | null;
    threshold: number;
    baseMinutes: number;
  },
): Promise<BreakerResult> {
  const r = await one<{ r: BreakerResult }>(
    q,
    "select provider_record($1, $2, $3, $4, $5, $6) as r",
    [p.provider, p.ok, p.cost, p.error, p.threshold, p.baseMinutes],
  );
  return r?.r ?? { opened: false, open_until: null, consecutive_failures: 0 };
}

export async function providerOpenUntil(
  q: Queryable,
  provider: string,
  until: Date,
  error: string,
): Promise<void> {
  await q.query("select provider_open_until($1, $2, $3)", [provider, until, error]);
}

/** True when the caller should actually deliver this alert (deduped inside the cooldown). */
export async function alertTry(
  q: Queryable,
  a: { key: string; kind: string; message: string; cooldownMinutes: number },
): Promise<boolean> {
  const r = await one<{ fire: boolean }>(q, "select alert_try($1, $2, $3, $4) as fire", [
    a.key,
    a.kind,
    a.message,
    a.cooldownMinutes,
  ]);
  return r?.fire === true;
}

export async function markAlertDelivered(q: Queryable, key: string): Promise<void> {
  await q.query(
    `update pipeline_alerts set delivered = true
      where id = (select max(id) from pipeline_alerts where key = $1)`,
    [key],
  );
}

export async function getFlag(q: Queryable, key: string): Promise<boolean> {
  const r = await one<{ enabled: boolean }>(q, "select enabled from feature_flags where key = $1", [
    key,
  ]);
  return r?.enabled === true; // a missing flag is off
}

export async function setFlag(q: Queryable, key: string, enabled: boolean): Promise<boolean> {
  const r = await q.query("update feature_flags set enabled = $2 where key = $1", [key, enabled]);
  return r.rowCount > 0;
}

export async function resetBreaker(q: Queryable, provider: string): Promise<void> {
  await q.query(
    "update provider_health set consecutive_failures = 0, open_until = null where provider = $1",
    [provider],
  );
}

// ---- maintenance (formerly pg_cron) -----------------------------------------

export async function purgeCache(q: Queryable): Promise<number> {
  const r = await q.query("delete from post_cache where purge_after < now()");
  return r.rowCount;
}

export async function purgeTelemetry(q: Queryable): Promise<void> {
  await q.query("delete from provider_calls where created_at < now() - interval '30 days'");
  await q.query("delete from pipeline_events where created_at < now() - interval '14 days'");
  await q.query("delete from pipeline_alerts where created_at < now() - interval '30 days'");
  await q.query("delete from provider_canary where checked_at < now() - interval '30 days'");
  await q.query("delete from device_submissions where created_at < now() - interval '30 days'");
}

export async function purgeExpiredArchives(q: Queryable): Promise<number> {
  const r = await q.query("delete from archived_saves where expires_at < now()");
  return r.rowCount;
}

/** One canary probe result per (provider, post); the alert reads the failure rate of the last few. */
export async function recordCanaryProbe(
  q: Queryable,
  r: {
    provider: string;
    contentId: string;
    ok: boolean;
    latencyMs: number;
    errorCode: string | null;
  },
): Promise<void> {
  await q.query(
    `insert into provider_canary (provider, content_id, ok, latency_ms, error_code)
     values ($1, $2, $3, $4, $5)`,
    [r.provider, r.contentId, r.ok, r.latencyMs, r.errorCode],
  );
}

export interface CanaryProbeRow extends Row {
  ok: boolean;
  error_code: string | null;
}

export async function recentCanaryProbes(
  q: Queryable,
  provider: string,
  limit: number,
): Promise<CanaryProbeRow[]> {
  const r = await q.query<CanaryProbeRow>(
    `select ok, error_code from provider_canary where provider = $1
      order by checked_at desc, id desc limit $2`,
    [provider, limit],
  );
  return r.rows;
}
