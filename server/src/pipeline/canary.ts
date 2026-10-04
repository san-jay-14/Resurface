import { recentCanaryStatuses } from "../db/repos/pipelineEvents.ts";
import type { PipelineContext } from "./context.ts";
import { ProviderUnavailable } from "./health.ts";
import { emit, errMessage, flush, newRun } from "./trace.ts";

/**
 * Every 15 minutes, fetch one known public Instagram shortcode and one known YouTube id through the
 * REAL adapters (bypassing caches) and alert after 2 consecutive failures. It also lets an open
 * breaker half-open when no user traffic is flowing.
 */
export async function runCanary(ctx: PipelineContext): Promise<string> {
  const targets = [
    { platform: "instagram", id: ctx.config.canary.igShortcode },
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
    const t0 = Date.now();
    let outcome: "ok" | "gated" | "error" = "ok";
    try {
      const adapter = ctx.registry.byId(c.platform);
      const raw = await adapter.fetchMeta(c.id);
      if (raw.status !== "ok") throw new Error(`canary resolved to ${raw.status}`);
      const meta = adapter.normalize(raw, c.id); // SchemaDrift surfaces here
      emit(run, "canary", "ok", `fetched + normalized (${meta.mediaType})`, {
        durationMs: Date.now() - t0,
      });
    } catch (e) {
      if (e instanceof ProviderUnavailable) {
        // The breaker/budget already owns the alert for this; do not double count.
        outcome = "gated";
        emit(run, "canary", "warn", `provider gate closed: ${errMessage(e)}`);
      } else {
        outcome = "error";
        emit(run, "canary", "error", errMessage(e), { durationMs: Date.now() - t0 });
      }
    }
    await flush(run);
    summary.push(`${c.platform}=${outcome}`);

    if (outcome === "error") {
      const last = await recentCanaryStatuses(ctx.db, c.platform, 2);
      if (last.length === 2 && last.every((s) => s === "error")) {
        await ctx.health.alert(
          `canary:${c.platform}`,
          "canary_failing",
          `${c.platform} canary failed twice in a row`,
          60,
        );
      }
    }
  }
  return summary.join(" ");
}
