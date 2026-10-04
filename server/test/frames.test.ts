import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createInstagramAdapter } from "../src/adapters/instagram.ts";
import { AcquireBlocked, TooLarge } from "../src/adapters/types.ts";
import type { Classification, ImageInput } from "../src/pipeline/classify.ts";
import {
  dedupeFrames,
  extractFrames,
  ffmpegAvailable,
  hamming,
  averageHash,
} from "../src/pipeline/extract.ts";
import { type FramesDeps, defaultFramesDeps, processFramesJob } from "../src/pipeline/frames.ts";
import { applyOutcome } from "../src/pipeline/process.ts";
import { newRun } from "../src/pipeline/trace.ts";
import { type PipelineTest, createPipelineTest } from "./helpers/world.ts";

const sh = promisify(execFile);
const haveFfmpeg = await ffmpegAvailable();
const open: PipelineTest[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((p) => p.t.db.close()));
});

const IMG: ImageInput = { kind: "base64", mediaType: "image/jpeg", data: "AAAA" };
const cls = (
  confidence: number,
  category: Classification["category"] = "Inspo",
): Classification => ({
  category,
  confidence,
  spots: [],
  evidence: "test",
});

async function frameLeftovers(): Promise<string[]> {
  return (await readdir(tmpdir())).filter((n) => n.startsWith("dibs-frames-"));
}

async function makeVideo(path: string, kind: "cuts" | "static", withAudio = false): Promise<void> {
  const src = (s: string) => ["-f", "lavfi", "-t", "2", "-i", `${s}=s=320x240:r=10`];
  const inputs =
    kind === "cuts"
      ? [...src("testsrc"), ...src("mandelbrot"), ...src("smptebars")]
      : src("smptebars");
  const audioIn = withAudio ? ["-f", "lavfi", "-t", "6", "-i", "sine=frequency=440"] : [];
  const maps =
    kind === "cuts"
      ? ["-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]"]
      : ["-map", "0:v"];
  const audioMap = withAudio ? ["-map", `${kind === "cuts" ? 3 : 1}:a`, "-shortest"] : [];
  await sh("ffmpeg", [
    "-y",
    "-v",
    "error",
    ...inputs,
    ...audioIn,
    ...maps,
    ...audioMap,
    "-pix_fmt",
    "yuv420p",
    path,
  ]);
}

describe.skipIf(!haveFfmpeg)("ffmpeg extraction (real ffmpeg)", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "frames-test-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("scene cuts yield 2–5 distinct frames, read the audio flag, and leave no temp dir", async () => {
    const f = join(dir, "cuts.mp4");
    await makeVideo(f, "cuts", true);
    const before = await frameLeftovers();
    const r = await extractFrames(f);
    expect(r.images.length).toBeGreaterThanOrEqual(2);
    expect(r.images.length).toBeLessThanOrEqual(5);
    expect(r.hasAudio).toBe(true);
    expect(r.durationSec).toBeGreaterThan(5);
    expect((await frameLeftovers()).length).toBe(before.length);
  });

  it("a static video (no scene cuts) falls back to uniform sampling", async () => {
    const f = join(dir, "static.mp4");
    await makeVideo(f, "static");
    const r = await extractFrames(f);
    expect(r.images.length).toBeGreaterThanOrEqual(1);
    expect(r.hasAudio).toBe(false);
  });

  it("garbage input fails cleanly and still cleans up", async () => {
    const f = join(dir, "garbage.mp4");
    await writeFile(f, "this is not a video, it is a #EXTM3U\nhttp://169.254.169.254/\n");
    const before = await frameLeftovers();
    await expect(extractFrames(f)).rejects.toThrow();
    expect((await frameLeftovers()).length).toBe(before.length);
  });

  it("identical frames are deduplicated by perceptual hash", async () => {
    const v = join(dir, "dupe.mp4");
    await makeVideo(v, "static");
    const jpg = join(dir, "a.jpg");
    await sh("ffmpeg", ["-y", "-v", "error", "-i", v, "-frames:v", "1", jpg]);
    const bytes = new Uint8Array(await readFile(jpg));
    expect(await dedupeFrames([bytes, bytes, bytes])).toHaveLength(1);
    expect(hamming(await averageHash(bytes), await averageHash(bytes))).toBe(0);
  });

  it("five concurrent jobs finish and leave no temp files behind", async () => {
    const src = join(dir, "conc.mp4");
    await makeVideo(src, "cuts");
    const before = await frameLeftovers();
    const results = await Promise.all(Array.from({ length: 5 }, () => extractFrames(src)));
    expect(results.every((r) => r.images.length >= 2)).toBe(true);
    expect((await frameLeftovers()).length).toBe(before.length);
  });
});

describe("frames stage flow", () => {
  async function seed(
    platform = "youtube",
    contentId = "dQw4w9WgXcQ",
    env: Record<string, string> = { FFMPEG_ENABLED: "true" },
  ) {
    const p = await createPipelineTest(env);
    open.push(p);
    const { t } = p;
    const userId = await t.makeUser("fr");
    const save = (
      await t.db.query<{ id: string }>(
        `insert into saves (user_id, source_platform, platform, content_id, enrichment_status)
         values ($1, $2, $2, $3, 'processing') returning id`,
        [userId, platform, contentId],
      )
    ).rows[0]!;
    await t.db.query(
      `insert into post_cache (platform, content_id, status, purge_after, expires_at, meta)
       values ($1, $2, 'ok', now() + interval '20 days', now() + interval '1 day', $3::jsonb)`,
      [
        platform,
        contentId,
        JSON.stringify({
          platform,
          contentId,
          canonicalUrl: "u",
          hashtags: [],
          mediaType: "short_video",
          thumbnailUrl: "https://i.ytimg.test/x.jpg",
          extras: {
            thumbnailCandidates: ["https://i.ytimg.test/x.jpg"],
            videoUrl: "https://scontent.cdninstagram.com/v.mp4",
          },
        }),
      ],
    );
    const job = (
      await t.db.query<{
        id: number;
        save_id: string;
        platform: string;
        content_id: string;
        attempts: number;
        stage: string;
      }>(
        `insert into enrichment_jobs (save_id, platform, content_id, stage, status, attempts)
         values ($1, $2, $3, 'frames', 'running', 1) returning id, save_id, platform, content_id, attempts, stage`,
        [save.id, platform, contentId],
      )
    ).rows[0]!;
    return { p, t, job, saveId: save.id };
  }

  const run = async (
    s: Awaited<ReturnType<typeof seed>>,
    over: Partial<FramesDeps> & { classify?: () => Classification } = {},
  ) => {
    const { classify, ...deps } = over;
    const ctx = s.t.svc;
    if (classify) ctx.classifier.classify = () => Promise.resolve(classify());
    else ctx.classifier.classify = () => Promise.resolve(cls(0.8));
    const r = newRun(ctx, { jobId: s.job.id, saveId: s.saveId });
    const outcome = await processFramesJob(ctx, r, s.job, {
      ...defaultFramesDeps(ctx),
      fetchThumbs: () => Promise.resolve([IMG]),
      ...deps,
    });
    await applyOutcome(ctx, r, s.job, outcome);
    return outcome;
  };
  const analysis = async (s: Awaited<ReturnType<typeof seed>>) =>
    (await s.t.db.query<{ resolved_by: string }>("select resolved_by from post_analysis")).rows;
  const setFlag = (s: Awaited<ReturnType<typeof seed>>, key: string, enabled: boolean) =>
    s.t.db.query(
      "insert into feature_flags (key, enabled) values ($1, $2) on conflict (key) do update set enabled = $2",
      [key, enabled],
    );

  it("with the frames flag OFF the video rung is skipped and thumbnails resolve the save", async () => {
    const s = await seed();
    await setFlag(s, "frames_youtube_enabled", false);
    let acquired = 0;
    const o = await run(s, {
      acquire: () => {
        acquired++;
        return Promise.reject(new Error("must not be called"));
      },
    });
    expect(o.kind).toBe("done");
    expect(acquired).toBe(0);
    expect(await analysis(s)).toEqual([{ resolved_by: "thumbnails" }]);
    const save = (
      await s.t.db.query<{ enrichment_status: string }>(
        "select enrichment_status from saves where id = $1",
        [s.saveId],
      )
    ).rows[0];
    expect(save?.enrichment_status).toBe("done");
    const ev = await s.t.db.query(
      "select 1 from pipeline_events where step = 'frames:video' and status = 'skip'",
    );
    expect(ev.rowCount).toBe(1);
  });

  it("a missing flag row counts as off (video is opt-in)", async () => {
    const s = await seed();
    let acquired = 0;
    await run(s, {
      acquire: () => {
        acquired++;
        return Promise.reject(new Error("no"));
      },
    });
    expect(acquired).toBe(0);
  });

  it("without ffmpeg on the host the video rung is skipped even if the flag is on", async () => {
    const s = await seed("youtube", "dQw4w9WgXcQ", {});
    await setFlag(s, "frames_youtube_enabled", true);
    let acquired = 0;
    await run(s, {
      videoSupported: false,
      acquire: () => {
        acquired++;
        return Promise.reject(new Error("no"));
      },
    });
    expect(acquired).toBe(0);
    expect(await analysis(s)).toEqual([{ resolved_by: "thumbnails" }]);
  });

  it("a blocked YouTube acquisition falls back to thumbnails and sets frames_retry_after (+24h)", async () => {
    const s = await seed();
    await setFlag(s, "frames_youtube_enabled", true);
    // the real, intentionally stubbed YouTube acquisition always reports AcquireBlocked
    const o = await run(s, { acquire: defaultFramesDeps(s.t.svc).acquire });
    expect(o.kind).toBe("done");
    expect(await analysis(s)).toEqual([{ resolved_by: "thumbnails" }]);
    const retry = (
      await s.t.db.query<{ frames_retry_after: Date }>("select frames_retry_after from post_cache")
    ).rows[0]!.frames_retry_after;
    expect(retry.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect(retry.getTime()).toBeLessThan(Date.now() + 25 * 3_600_000);

    // another save of the same post inside the window: the video rung is not even attempted
    await s.t.db.query("delete from post_analysis");
    const other = await s.t.makeUser("fr2");
    const save2 = (
      await s.t.db.query<{ id: string }>(
        "insert into saves (user_id, source_platform, enrichment_status) values ($1,'youtube','processing') returning id",
        [other],
      )
    ).rows[0]!;
    const job2 = (
      await s.t.db.query<{
        id: number;
        save_id: string;
        platform: string;
        content_id: string;
        attempts: number;
        stage: string;
      }>(
        `insert into enrichment_jobs (save_id, platform, content_id, stage, status, attempts)
       values ($1, 'youtube', 'dQw4w9WgXcQ', 'frames', 'running', 1) returning id, save_id, platform, content_id, attempts, stage`,
        [save2.id],
      )
    ).rows[0]!;
    let tried = 0;
    const ctx = s.t.svc;
    ctx.classifier.classify = () => Promise.resolve(cls(0.8));
    const r = newRun(ctx, {});
    await processFramesJob(ctx, r, job2, {
      ...defaultFramesDeps(ctx),
      fetchThumbs: () => Promise.resolve([IMG]),
      acquire: () => {
        tried++;
        return Promise.reject(new AcquireBlocked());
      },
    });
    expect(tried).toBe(0);
  });

  it("video rung success resolves as 'frames' and removes the downloaded file", async () => {
    const s = await seed();
    await setFlag(s, "frames_youtube_enabled", true);
    let cleaned = 0;
    const o = await run(s, {
      acquire: () =>
        Promise.resolve({
          filePath: "/nope.mp4",
          cleanup: () => {
            cleaned++;
            return Promise.resolve();
          },
        }),
      extract: () => Promise.resolve({ images: [IMG, IMG, IMG], hasAudio: false, durationSec: 12 }),
    });
    expect(o.kind).toBe("done");
    expect(await analysis(s)).toEqual([{ resolved_by: "frames" }]);
    expect(cleaned).toBe(1);
  });

  it("cleanup still runs when extraction throws", async () => {
    const s = await seed();
    await setFlag(s, "frames_youtube_enabled", true);
    let cleaned = 0;
    await run(s, {
      acquire: () =>
        Promise.resolve({
          filePath: "/nope.mp4",
          cleanup: () => {
            cleaned++;
            return Promise.resolve();
          },
        }),
      extract: () => Promise.reject(new Error("ffmpeg exploded")),
    });
    expect(cleaned).toBe(1);
  });

  it("typed acquisition failures fall through; nothing confident means needs_review (never guess)", async () => {
    const s = await seed();
    await setFlag(s, "frames_youtube_enabled", true);
    const o = await run(s, {
      acquire: () => Promise.reject(new TooLarge("80 MB")),
      classify: () => cls(0.3),
    });
    expect(o.kind).toBe("needs_review");
    const save = (
      await s.t.db.query(
        "select enrichment_status, enrichment_reason, status from saves where id = $1",
        [s.saveId],
      )
    ).rows[0];
    expect(save).toMatchObject({
      enrichment_status: "needs_review",
      enrichment_reason: "low_confidence",
      status: "manual",
    });
    expect((await analysis(s)).length).toBe(0);
    const retry = (
      await s.t.db.query<{ frames_retry_after: Date | null }>(
        "select frames_retry_after from post_cache",
      )
    ).rows[0];
    expect(retry?.frames_retry_after).toBeNull(); // only AcquireBlocked sets the retry window
  });

  it("copies an analysis another save already produced instead of redoing frames work", async () => {
    const s = await seed();
    await s.t.db.query(
      `insert into post_analysis (platform, content_id, prompt_version, model, category, confidence, spots, resolved_by)
       values ('youtube', 'dQw4w9WgXcQ', 1, 'claude-haiku-4-5-20251001', 'recipes', 0.9, '[]', 'caption')`,
    );
    let work = 0;
    const o = await run(s, {
      fetchThumbs: () => {
        work++;
        return Promise.resolve([]);
      },
    });
    expect(o.kind).toBe("done");
    expect(work).toBe(0);
    expect(
      (
        await s.t.db.query<{ category: string }>("select category from saves where id = $1", [
          s.saveId,
        ])
      ).rows[0]?.category,
    ).toBe("recipes");
  });
});

describe("instagram video acquisition caps", () => {
  const hiker = {
    fetchMediaByUrl: () => Promise.reject(new Error("x")),
    fetchCommentsRaw: () => Promise.reject(new Error("x")),
  };
  const meta = (videoUrl: string) => ({ extras: { videoUrl } }) as never;
  const caps = { maxBytes: 50 * 1024 * 1024, timeoutMs: 60_000 };

  it("rejects a file over 50 MB before downloading it, and non-CDN hosts outright", async () => {
    const fake = (() =>
      Promise.resolve(
        new Response("x", { status: 200, headers: { "content-length": String(60 * 1024 * 1024) } }),
      )) as typeof fetch;
    const ig = createInstagramAdapter({ fetch: fake, hiker });
    await expect(
      ig.acquireVideo?.("Cabc123xyz", meta("https://scontent.cdninstagram.com/v.mp4"), caps),
    ).rejects.toBeInstanceOf(TooLarge);
    await expect(
      ig.acquireVideo?.("Cabc123xyz", meta("http://169.254.169.254/v.mp4"), {
        maxBytes: 1,
        timeoutMs: 1000,
      }),
    ).rejects.toBeInstanceOf(AcquireBlocked);
  });

  it("cuts off a streamed body that exceeds the cap without a content-length, leaving nothing behind", async () => {
    const fake = (() =>
      Promise.resolve(new Response(new Uint8Array(2048), { status: 200 }))) as typeof fetch;
    const ig = createInstagramAdapter({ fetch: fake, hiker });
    const leftovers = async () =>
      (await readdir(tmpdir())).filter((n) => n.startsWith("dibs-ig-")).length;
    const before = await leftovers();
    await expect(
      ig.acquireVideo?.("Cabc123xyz", meta("https://scontent.cdninstagram.com/v.mp4"), {
        maxBytes: 1024,
        timeoutMs: 5000,
      }),
    ).rejects.toBeInstanceOf(TooLarge);
    expect(await leftovers()).toBe(before);
  });

  it.skipIf(!haveFfmpeg)("downloads within the caps and cleans up on request", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ig-src-"));
    const src = join(dir, "v.mp4");
    await makeVideo(src, "static");
    const bytes = await readFile(src);
    const fake = (() => Promise.resolve(new Response(bytes, { status: 200 }))) as typeof fetch;
    const ig = createInstagramAdapter({ fetch: fake, hiker });
    const handle = await ig.acquireVideo?.(
      "Cabc123xyz",
      meta("https://scontent.cdninstagram.com/v.mp4"),
      caps,
    );
    expect(handle).toBeTruthy();
    expect((await stat(handle!.filePath)).size).toBe(bytes.byteLength);
    await handle!.cleanup();
    await expect(stat(handle!.filePath)).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });
});
