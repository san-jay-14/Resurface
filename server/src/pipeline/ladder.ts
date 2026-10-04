import { type PostMeta, ProviderError } from "../adapters/types.ts";
import {
  type Classification,
  type Evidence,
  evidenceFromMeta,
  hasTextEvidence,
} from "./classify.ts";
import { ProviderUnavailable } from "./health.ts";
import { emit, errMessage, type RunCtx } from "./trace.ts";

/**
 * The fallback ladder: classify from the cheapest evidence first, escalate only when confidence is
 * below the threshold, merging everything gathered into each new call.
 *   1. metadata  2. comments  3. frames (async, handed to the frames stage)  4. give up -> needs_review
 * (never guess). Dependencies are injected so the ladder is testable without a network.
 */
export interface LadderDeps {
  classify(e: Evidence): Promise<Classification>;
  /** Filtered comments, or null when the adapter has none / they could not be fetched. */
  getComments?: () => Promise<string[] | null>;
  /** True when the adapter lists any frames rung. */
  canFrames: boolean;
  threshold: number;
}

export type LadderResult =
  | { kind: "resolved"; rung: "caption" | "comments"; classification: Classification }
  | { kind: "needs_frames"; best: Classification | null }
  | { kind: "needs_review"; reason: string; best: Classification | null };

const pct = (n: number) => `${Math.round(n * 100)}%`;

export async function runLadder(
  run: RunCtx,
  meta: PostMeta,
  deps: LadderDeps,
): Promise<LadderResult> {
  let best: Classification | null = null;

  // Rung 1 — metadata
  const e1 = evidenceFromMeta(meta);
  if (!hasTextEvidence(e1)) {
    emit(
      run,
      "ladder:metadata",
      "skip",
      "no textual evidence (empty caption/title/tags); not spending a model call",
    );
  } else {
    const t0 = Date.now();
    const c = await deps.classify(e1);
    best = c;
    const ok = c.confidence >= deps.threshold;
    emit(
      run,
      "ladder:metadata",
      ok ? "ok" : "warn",
      `${c.category} @ ${pct(c.confidence)} (threshold ${pct(deps.threshold)})${ok ? " — resolved" : " — escalating"}`,
      {
        durationMs: Date.now() - t0,
        meta: { category: c.category, confidence: c.confidence, evidence: c.evidence },
      },
    );
    if (ok) return { kind: "resolved", rung: "caption", classification: c };
  }

  // Rung 2 — comments
  if (deps.getComments) {
    let fetched: string[] | null = null;
    const t0 = Date.now();
    try {
      fetched = await deps.getComments();
    } catch (e) {
      // Fail soft: a blocked/rate-limited/down comments source degrades to the next rung.
      if (e instanceof ProviderError || e instanceof ProviderUnavailable) {
        emit(run, "ladder:comments", "warn", `comments unavailable, degrading: ${errMessage(e)}`, {
          durationMs: Date.now() - t0,
        });
      } else throw e;
    }
    if (fetched?.length) {
      const comments = fetched;
      const c = await deps.classify(evidenceFromMeta(meta, { comments }));
      if (!best || c.confidence >= best.confidence) best = c;
      const ok = c.confidence >= deps.threshold;
      emit(
        run,
        "ladder:comments",
        ok ? "ok" : "warn",
        `${comments.length} comments → ${c.category} @ ${pct(c.confidence)}${ok ? " — resolved" : " — escalating"}`,
        {
          durationMs: Date.now() - t0,
          meta: { category: c.category, confidence: c.confidence, comments: comments.length },
        },
      );
      if (ok) return { kind: "resolved", rung: "comments", classification: c };
    } else if (fetched) {
      emit(run, "ladder:comments", "skip", "no usable comments", { durationMs: Date.now() - t0 });
    }
  } else {
    emit(run, "ladder:comments", "skip", "adapter has no comments");
  }

  // Rung 3 — frames (async)
  if (deps.canFrames) {
    emit(run, "ladder:frames", "info", "confidence still low; handing to the frames stage");
    return { kind: "needs_frames", best };
  }

  // Rung 4 — give up
  emit(run, "ladder:give_up", "warn", "every rung exhausted below threshold; needs manual review");
  return { kind: "needs_review", reason: "low_confidence", best };
}
