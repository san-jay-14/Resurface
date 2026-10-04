import { ProviderError, SchemaDrift } from "../adapters/types.ts";
import { recentCanaryProbes, recordCanaryProbe } from "../db/repos/pipelineHealth.ts";
import type { PipelineContext } from "./context.ts";
import { ProviderUnavailable } from "./health.ts";
import { emit, errMessage, flush, newRun } from "./trace.ts";

/** The canary runs every 15 minutes (see scheduler/tasks.ts); this is the rotation step. */
const RUN_EVERY_MS = 15 * 60_000;
const WINDOW = 6; // probes considered per provider
const MIN_PROBES = 4; // do not alert on a near-empty history
const ALERT_COOLDOWN_MINUTES = 360; // at most one alert per provider per 6 hours

const errorCode = (e: unknown): string =>
  e instanceof ProviderError
    ? e.kind
    : e instanceof SchemaDrift
      ? "schema_drift"
      : e instanceof Error
        ? e.name
        : "error";

/**
 * Probe a known public post through the REAL adapters, bypassing every cache, once per enabled
 * provider, and record each result in provider_canary. A provider whose failure rate over its last
 * 6 probes exceeds 50% raises one alert per 6 hours: the early warning for an upstream change (e.g.
 * a rotated doc_id) before users notice. It also lets an open breaker half-open when no user
 * traffic is flowing.
 *
 * Instagram probes ONE post per run, rotating through CANARY_IG_SHORTCODES, so N canary posts cost
 * the same as one (about 96 provider calls a day) while still covering all of them.
 */
export async function runCanary(ctx: PipelineContext): Promise<string> {
  const igCodes = ctx.config.canary.igShortcodes;
  const igPick = igCodes.length
    ? igCodes[Math.floor(ctx.now().getTime() / RUN_EVERY_MS) % igCodes.length]
    : undefined;
  const targets = [
    { platform: "instagram", id: igPick },
    { platform: "youtube", id: ctx.config.canary.ytId },
  ];
  const summary: string[] = [];

  for (const c of targets) {
    const run = newRun(ctx, { platform: c.platform, ...(c.id ? { contentId: c.id } : {}) });
    if (!c.id) {
      emit(run, "canary", "skip", `no canary id configured for ${c.platform}`);
      await flush(run);
      summary.push(`${c.platform}=skipped`);
      continue;
    }
    const id = c.id;
    const adapter = ctx.registry.byId(c.platform);
    const probes = adapter.probes?.() ?? [
      { name: adapter.policy.provider, fetch: (cid: string) => adapter.fetchMeta(cid) },
    ];
    if (!probes.length) {
      emit(run, "canary", "skip", `no ${c.platform} provider enabled`);
      await flush(run);
      summary.push(`${c.platform}=no_provider`);
      continue;
    }

    for (const probe of probes) {
      const t0 = Date.now();
      let outcome: "ok" | "gated" | "error" = "ok";
      let code: string | null = null;
      try {
        const raw = await probe.fetch(id);
        if (raw.status !== "ok") throw new Error(`canary resolved to ${raw.status}`);
        const meta = adapter.normalize(raw, id); // SchemaDrift surfaces here
        emit(run, "canary", "ok", `${probe.name}: fetched + normalized (${meta.mediaType})`, {
          durationMs: Date.now() - t0,
        });
      } catch (e) {
        if (e instanceof ProviderUnavailable) {
          // The breaker/budget already owns the alert for this; do not double count.
          outcome = "gated";
          emit(run, "canary", "warn", `${probe.name}: provider gate closed: ${errMessage(e)}`);
        } else {
          outcome = "error";
          code = errorCode(e);
          emit(run, "canary", "error", `${probe.name}: ${errMessage(e)}`, {
            durationMs: Date.now() - t0,
          });
        }
      }
      summary.push(`${c.platform}/${probe.name}=${outcome}`);
      if (outcome === "gated") continue;

      await recordCanaryProbe(ctx.db, {
        provider: probe.name,
        contentId: id,
        ok: outcome === "ok",
        latencyMs: Date.now() - t0,
        errorCode: code,
      });
      if (outcome === "error") {
        const last = await recentCanaryProbes(ctx.db, probe.name, WINDOW);
        const failed = last.filter((r) => !r.ok).length;
        if (last.length >= MIN_PROBES && failed / last.length > 0.5) {
          await ctx.health.alert(
            `canary:${probe.name}`,
            "canary_failing",
            `${probe.name} canary failing: ${failed}/${last.length} recent probes failed (last error: ${last.find((r) => !r.ok)?.error_code ?? "unknown"})`,
            ALERT_COOLDOWN_MINUTES,
          );
        }
      }
    }
    await flush(run);
  }
  return summary.join(" ");
}
