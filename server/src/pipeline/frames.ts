import { assertPublicUrl } from "../adapters/ssrf.ts";
import {
  AcquireBlocked,
  NotFound,
  type PlatformAdapter,
  type PostMeta,
  TooLarge,
  TooLong,
} from "../adapters/types.ts";
import { getAnalysis, getPostCache, setFramesRetryAfter } from "../db/repos/pipelineCache.ts";
import { getFlag } from "../db/repos/pipelineHealth.ts";
import { addHours } from "./cache.ts";
import { type Classification, type ImageInput, evidenceFromMeta } from "./classify.ts";
import type { PipelineContext } from "./context.ts";
import { type Extracted, extractFrames } from "./extract.ts";
import {
  type JobRef,
  type Outcome,
  type Target,
  applyCachedAnalysis,
  outcomeFromError,
  resolveAndStore,
} from "./process.ts";
import { emit, errMessage, type RunCtx } from "./trace.ts";

/**
 * Frames rung. Platform-blind: only video ACQUISITION differs per platform (adapter.acquireVideo).
 *   1. walk adapter.frames in order ('video' then 'thumbnails')
 *   2. video is opt-in: needs ffmpeg on this host, the platform flag on, and no recent block
 *   3. video: acquire (50 MB / 3 min / 60 s caps) -> ffprobe -> ffmpeg keyframes -> dedupe
 *   4. one multimodal call with 3-5 images + the text gathered so far
 *   5. typed acquisition failures fall through to the next rung, then needs_review
 *   6. temp files are removed in `finally`; video and frames are never persisted
 */
export const CAPS = { maxBytes: 50 * 1024 * 1024, acquireTimeoutMs: 60_000 };
const MAX_IMAGES = 5;

export interface FramesDeps {
  acquire(
    adapter: PlatformAdapter,
    id: string,
    meta: PostMeta,
  ): Promise<{ filePath: string; cleanup(): Promise<void> }>;
  extract(filePath: string): Promise<Extracted>;
  fetchThumbs(urls: string[]): Promise<ImageInput[]>;
  /** Whether the video rung can run on this host (ffmpeg installed and enabled). */
  videoSupported: boolean;
}

/** Thumbnail URLs -> base64 images, SSRF-checked, size capped. */
export function createThumbFetcher(
  ctx: Pick<PipelineContext, "fetch" | "resolveDns">,
): FramesDeps["fetchThumbs"] {
  return async (urls) => {
    const out: ImageInput[] = [];
    for (const raw of urls) {
      if (out.length >= 3) break;
      try {
        const u = new URL(raw);
        await assertPublicUrl(u, ctx.resolveDns);
        const resp = await ctx.fetch(u, { redirect: "error", signal: AbortSignal.timeout(8000) });
        if (!resp.ok) continue;
        const buf = new Uint8Array(await resp.arrayBuffer());
        if (buf.byteLength > 4_000_000 || buf.byteLength < 500) continue;
        const type = (resp.headers.get("content-type") ?? "image/jpeg").split(";")[0] ?? "";
        if (!["image/jpeg", "image/png", "image/webp"].includes(type)) continue;
        out.push({
          kind: "base64",
          mediaType: type as "image/jpeg",
          data: Buffer.from(buf).toString("base64"),
        });
      } catch {
        /* try the next candidate */
      }
    }
    return out;
  };
}

export function defaultFramesDeps(ctx: PipelineContext): FramesDeps {
  return {
    acquire: (adapter, id, meta) => {
      if (!adapter.acquireVideo) throw new NotFound("adapter has no acquireVideo");
      return adapter.acquireVideo(id, meta, {
        maxBytes: CAPS.maxBytes,
        timeoutMs: CAPS.acquireTimeoutMs,
      });
    },
    extract: extractFrames,
    fetchThumbs: createThumbFetcher(ctx),
    videoSupported: ctx.config.pipeline.ffmpegEnabled,
  };
}

function thumbCandidates(meta: PostMeta): string[] {
  const c = (meta.extras.thumbnailCandidates as string[] | undefined) ?? [];
  return [
    ...new Set(
      [meta.extras.mirroredThumbnail as string | undefined, ...c, meta.thumbnailUrl].filter(
        (x): x is string => !!x,
      ),
    ),
  ];
}

export async function processFramesJob(
  ctx: PipelineContext,
  run: RunCtx,
  job: JobRef & { platform: string; content_id: string },
  deps: FramesDeps = defaultFramesDeps(ctx),
): Promise<Outcome> {
  const { db, config } = ctx;
  const target: Target = {
    platform: job.platform,
    contentId: job.content_id,
    saveId: job.save_id,
    attempts: job.attempts,
    jobId: job.id,
    stage: "fetch",
    writeback: true,
  };
  try {
    const adapter = ctx.registry.byId(job.platform);

    // Another save of the same post may have resolved while this job waited.
    const cached = await getAnalysis(
      db,
      job.platform,
      job.content_id,
      config.pipeline.promptVersion,
      config.pipeline.classifierModel,
    );
    const row = await getPostCache(db, job.platform, job.content_id);
    if (cached) {
      emit(
        run,
        "frames:analysis_cache",
        "ok",
        "already analysed by another save — copying, no frames work",
      );
      return await applyCachedAnalysis(ctx, run, target, cached, row?.meta ?? null);
    }
    if (!row?.meta) {
      emit(run, "frames:meta", "warn", "no cached metadata for this post");
      return { kind: "needs_review", reason: "no_meta" };
    }
    const meta = row.meta;
    const comments = (meta.extras.comments as string[] | undefined) ?? [];
    const now = ctx.now();
    let best: Classification | null = null;

    for (const rung of adapter.frames) {
      let images: ImageInput[] = [];
      let resolvedBy: "frames" | "thumbnails" = "frames";

      if (rung === "video") {
        const flag = `frames_${adapter.id}_enabled`;
        if (!deps.videoSupported) {
          emit(
            run,
            "frames:video",
            "skip",
            "video rung unavailable on this host (ffmpeg not enabled)",
          );
          continue;
        }
        if (!(await getFlag(db, flag))) {
          emit(run, "frames:video", "skip", `feature flag ${flag} is off`);
          continue;
        }
        if (row.frames_retry_after && row.frames_retry_after.getTime() > now.getTime()) {
          emit(
            run,
            "frames:video",
            "skip",
            `acquisition blocked recently; retry after ${row.frames_retry_after.toISOString()}`,
          );
          continue;
        }
        let handle: { filePath: string; cleanup(): Promise<void> } | null = null;
        const t0 = Date.now();
        try {
          handle = await deps.acquire(adapter, job.content_id, meta);
          emit(run, "frames:acquire", "ok", "video acquired", { durationMs: Date.now() - t0 });
          const ex = await deps.extract(handle.filePath);
          images = ex.images.slice(0, MAX_IMAGES);
          emit(
            run,
            "frames:extract",
            images.length ? "ok" : "warn",
            `${images.length} frames after dedupe; audio=${ex.hasAudio}; duration=${ex.durationSec ?? "?"}s`,
            { durationMs: Date.now() - t0 },
          );
        } catch (e) {
          if (e instanceof AcquireBlocked) {
            await setFramesRetryAfter(db, job.platform, job.content_id, addHours(now, 24));
            emit(
              run,
              "frames:acquire",
              "warn",
              `blocked (${errMessage(e)}); negative-cached 24h, falling back`,
            );
          } else if (e instanceof TooLarge || e instanceof TooLong || e instanceof NotFound) {
            emit(run, "frames:acquire", "warn", `${e.name}: ${e.message}; falling back`);
          } else throw e;
        } finally {
          await handle?.cleanup();
        }
      } else {
        resolvedBy = "thumbnails";
        images = (await deps.fetchThumbs(thumbCandidates(meta))).slice(0, MAX_IMAGES);
        emit(
          run,
          "frames:thumbnails",
          images.length ? "ok" : "warn",
          `${images.length} thumbnail image(s) fetched`,
        );
      }

      if (!images.length) continue;
      const t1 = Date.now();
      const c = await ctx.classifier.classify(
        evidenceFromMeta(meta, { comments, images }),
        job.content_id,
      );
      if (!best || c.confidence > best.confidence) best = c;
      const ok = c.confidence >= config.pipeline.confidenceThreshold;
      emit(
        run,
        "frames:classify",
        ok ? "ok" : "warn",
        `${rung} → ${c.category} @ ${Math.round(c.confidence * 100)}%${ok ? " — resolved" : " — below threshold"}`,
        {
          durationMs: Date.now() - t1,
          meta: { category: c.category, confidence: c.confidence, rung: resolvedBy },
        },
      );
      if (ok) return await resolveAndStore(ctx, run, target, meta, c, resolvedBy);
    }

    emit(
      run,
      "frames:give_up",
      "warn",
      "no frames rung produced a confident answer; needs manual review",
    );
    return { kind: "needs_review", reason: "low_confidence", meta };
  } catch (e) {
    return outcomeFromError(ctx, run, e);
  }
}
