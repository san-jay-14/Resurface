import { ProviderError } from "../adapters/types.ts";
import {
  alertTry,
  getHealth,
  markAlertDelivered,
  providerOpenUntil,
  providerRecord,
  recordCall,
} from "../db/repos/pipelineHealth.ts";
import { errorMessage } from "../util.ts";
import type { BaseDeps } from "./context.ts";
import { redact } from "./trace.ts";

/**
 * Production controls, keyed by provider (not platform): circuit breaker, daily budget cap, call
 * telemetry and alerts. Every external call goes through callProvider() so none of these can be
 * bypassed.
 */

/** Thrown when a provider is unavailable because its breaker is open or its budget is spent. */
export class ProviderUnavailable extends Error {
  constructor(
    public provider: string,
    public until: Date,
    public reason: "breaker" | "budget",
  ) {
    super(
      `${provider} ${reason === "breaker" ? "breaker open" : "budget exhausted"} until ${until.toISOString()}`,
    );
    this.name = "ProviderUnavailable";
  }
}

export function nextUtcMidnight(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/** Next midnight in America/Los_Angeles (YouTube Data API quota reset). */
export function nextPacificMidnight(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const secsIntoDay = get("hour") * 3600 + get("minute") * 60 + get("second");
  return new Date(now.getTime() + (86400 - secsIntoDay) * 1000);
}

/** Exponential backoff with ~20% jitter. `attempt` is 1-based (the attempt that just failed). */
export function backoffMs(attempt: number, retryAfterMs?: number, rand = Math.random): number {
  const steps = [30_000, 120_000, 600_000, 1_800_000];
  const base = steps[Math.min(Math.max(attempt - 1, 0), steps.length - 1)] as number;
  const jittered = base * (1 + (rand() * 0.4 - 0.2));
  return Math.max(jittered, retryAfterMs ?? 0);
}

export type Availability = { ok: true } | { ok: false; until: Date; reason: "breaker" | "budget" };

export interface CallOpts {
  provider: string;
  endpoint: string;
  platform?: string;
  contentId?: string;
}

export interface CallOutcome<T> {
  /** HTTP status to record in provider_calls. */
  status: number;
  value: T;
  /** Estimated cost in the provider's budget unit. */
  cost?: number;
}

// Failure kinds that say the provider itself is unhealthy. not_found/private are normal outcomes
// (never thrown), blocked is per-resource, budget is ours.
const BREAKER_KINDS = new Set(["upstream", "rate_limited", "auth"]);

export type Health = ReturnType<typeof createHealth>;

export function createHealth(deps: BaseDeps) {
  const { db, config, log } = deps;

  async function availability(provider: string): Promise<Availability> {
    const row = await getHealth(db, provider);
    if (!row) return { ok: true };
    const now = deps.now();
    if (row.open_until && row.open_until.getTime() > now.getTime()) {
      return { ok: false, until: row.open_until, reason: "breaker" };
    }
    const today = now.toISOString().slice(0, 10);
    const budget = config.pipeline.budgets[provider] ?? Number.POSITIVE_INFINITY;
    if (row.spend_day === today && Number(row.spend_today) >= budget) {
      return { ok: false, until: nextUtcMidnight(now), reason: "budget" };
    }
    return { ok: true };
  }

  async function alert(
    key: string,
    kind: string,
    message: string,
    cooldownMinutes = 30,
  ): Promise<void> {
    try {
      const text = redact(message);
      if (!(await alertTry(db, { key, kind, message: text, cooldownMinutes }))) return;
      log.warn({ kind, key }, text);
      const url = config.providers.alertWebhookUrl;
      if (!url) return;
      const resp = await deps.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `[dibs pipeline] ${kind}: ${text}` }),
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) await markAlertDelivered(db, key);
    } catch (err) {
      log.error({ err: errorMessage(err) }, "alert delivery failed");
    }
  }

  async function callProvider<T>(o: CallOpts, fn: () => Promise<CallOutcome<T>>): Promise<T> {
    const av = await availability(o.provider);
    if (!av.ok) throw new ProviderUnavailable(o.provider, av.until, av.reason);

    const t0 = Date.now();
    let status: number | null = null;
    let cost = 0;
    let failure: ProviderError | null = null;
    try {
      const r = await fn();
      status = r.status;
      cost = r.cost ?? 0;
      return r.value;
    } catch (e) {
      if (e instanceof ProviderError) {
        failure = e;
        status = e.httpStatus ?? null;
        throw e;
      }
      // Timeouts and network failures are upstream failures.
      if (
        e instanceof Error &&
        (e.name === "TimeoutError" || e.name === "AbortError" || e instanceof TypeError)
      ) {
        failure = new ProviderError("upstream", undefined, undefined, redact(errorMessage(e)));
        throw failure;
      }
      throw e;
    } finally {
      // Telemetry and breaker bookkeeping are best-effort and must not mask the real result.
      await bookkeep(o, { status, cost, failure, latencyMs: Date.now() - t0 }).catch(
        (err: unknown) => log.error({ err: errorMessage(err) }, "provider bookkeeping failed"),
      );
    }
  }

  async function bookkeep(
    o: CallOpts,
    r: { status: number | null; cost: number; failure: ProviderError | null; latencyMs: number },
  ): Promise<void> {
    await recordCall(db, {
      provider: o.provider,
      endpoint: o.endpoint,
      platform: o.platform ?? null,
      contentId: o.contentId ?? null,
      statusCode: r.status,
      latencyMs: r.latencyMs,
      cost: r.cost,
    });
    const { failure } = r;
    if (failure?.kind === "quota") {
      const until = nextPacificMidnight(deps.now());
      await providerOpenUntil(db, o.provider, until, "quota exceeded");
      await alert(
        `quota:${o.provider}`,
        "quota_exceeded",
        `${o.provider} quota exceeded; breaker open until ${until.toISOString()}`,
        120,
      );
      return;
    }
    if (failure && !BREAKER_KINDS.has(failure.kind)) return;

    const res = await providerRecord(db, {
      provider: o.provider,
      ok: !failure,
      cost: r.cost,
      error: failure?.message ?? null,
      threshold: config.pipeline.breakerThreshold,
      baseMinutes: config.pipeline.breakerBaseMinutes,
    });
    if (res.opened) {
      await alert(
        `breaker:${o.provider}`,
        "breaker_opened",
        `${o.provider} breaker opened until ${res.open_until} after ${res.consecutive_failures} failures`,
        15,
      );
    }
    if (failure && (failure.kind === "auth" || failure.kind === "budget")) {
      await alert(
        `provider_${failure.kind}:${o.provider}`,
        `provider_${failure.kind}`,
        `${o.provider} returned HTTP ${failure.httpStatus ?? "?"} (${failure.kind}). Check the API key / plan.`,
        60,
      );
    }
    // Flag our own budget breach once.
    if (!failure && r.cost > 0) {
      const av = await availability(o.provider);
      if (!av.ok && av.reason === "budget") {
        await alert(
          `budget:${o.provider}`,
          "budget_hit",
          `${o.provider} daily budget (${config.pipeline.budgets[o.provider]}) reached; degrading to cache-only`,
          360,
        );
      }
    }
  }

  return { availability, alert, callProvider };
}
