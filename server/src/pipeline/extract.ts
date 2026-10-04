import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Image } from "imagescript";
import type { ImageInput } from "./classify.ts";

/**
 * ffprobe + ffmpeg keyframe extraction for UNTRUSTED media.
 *  - local files only: -protocol_whitelist file stops crafted playlists fetching URLs
 *  - hard timeouts, private temp dir removed in `finally`
 *  - scene detection finds cuts but misses static text slides, so fall back to uniform sampling
 *    when it yields fewer than 2 frames
 *  - near-duplicate frames dropped by perceptual (average) hash
 * Requires `ffmpeg`/`ffprobe` on PATH; see Dockerfile. Used only by the frames video rung.
 */
const run = promisify(execFile);
const FFMPEG_TIMEOUT_MS = 45_000;
const PROBE_TIMEOUT_MS = 10_000;

async function exec(
  cmd: string,
  args: string[],
  timeout: number,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(cmd, args, { timeout, maxBuffer: 10 * 1024 * 1024 });
    return { ok: true, stdout, stderr };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, stdout: err.stdout ?? "", stderr: err.stderr ?? String(e) };
  }
}

export async function ffmpegAvailable(): Promise<boolean> {
  return (await exec("ffmpeg", ["-version"], 5000)).ok;
}

export interface Probe {
  durationSec?: number;
  hasAudio: boolean;
}

export async function probe(file: string): Promise<Probe> {
  const r = await exec(
    "ffprobe",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      file,
    ],
    PROBE_TIMEOUT_MS,
  );
  if (!r.ok) throw new Error(`ffprobe failed: ${r.stderr.slice(0, 200)}`);
  const j = JSON.parse(r.stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string }>;
  };
  const d = Number(j.format?.duration);
  return {
    ...(Number.isFinite(d) ? { durationSec: d } : {}),
    hasAudio: !!j.streams?.some((s) => s.codec_type === "audio"),
  };
}

/** 64-bit average hash as a bigint. */
export async function averageHash(jpeg: Uint8Array): Promise<bigint> {
  const img = (await Image.decode(jpeg)).resize(8, 8);
  const lum: number[] = [];
  for (let y = 1; y <= 8; y++) {
    for (let x = 1; x <= 8; x++) {
      const [r = 0, g = 0, b = 0] = Image.colorToRGBA(img.getPixelAt(x, y));
      lum.push(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
  return lum.reduce((h, v, i) => (v >= mean ? h | (1n << BigInt(i)) : h), 0n);
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Keep frames that differ from every kept frame by more than `minDistance` bits. */
export async function dedupeFrames(frames: Uint8Array[], minDistance = 6): Promise<Uint8Array[]> {
  const kept: Array<{ f: Uint8Array; h: bigint }> = [];
  for (const f of frames) {
    let h: bigint;
    try {
      h = await averageHash(f);
    } catch {
      continue; // undecodable frame
    }
    if (kept.every((k) => hamming(k.h, h) > minDistance)) kept.push({ f, h });
  }
  return kept.map((k) => k.f);
}

async function readFrames(dir: string): Promise<Uint8Array[]> {
  const names = (await readdir(dir)).filter((n) => /^f_.*\.jpg$/.test(n)).sort();
  return Promise.all(names.map((n) => readFile(join(dir, n))));
}

export interface Extracted {
  images: ImageInput[];
  hasAudio: boolean;
  durationSec?: number;
}

export async function extractFrames(filePath: string): Promise<Extracted> {
  const p = await probe(filePath);
  const dir = await mkdtemp(join(tmpdir(), "dibs-frames-"));
  try {
    const base = ["-nostdin", "-protocol_whitelist", "file", "-i", filePath];
    const sceneVf = "select='gt(scene,0.3)',scale=480:-2";
    // -fps_mode needs ffmpeg >= 5.1; older builds want -vsync.
    let r = await exec(
      "ffmpeg",
      [...base, "-vf", sceneVf, "-fps_mode", "vfr", "-frames:v", "6", join(dir, "f_%02d.jpg")],
      FFMPEG_TIMEOUT_MS,
    );
    if (!r.ok && /Unrecognized option 'fps_mode'/i.test(r.stderr)) {
      r = await exec(
        "ffmpeg",
        [...base, "-vf", sceneVf, "-vsync", "vfr", "-frames:v", "6", join(dir, "f_%02d.jpg")],
        FFMPEG_TIMEOUT_MS,
      );
    }
    let frames = await readFrames(dir);

    if (frames.length < 2) {
      // Uniform sampling: ~5 frames across the duration.
      for (const n of await readdir(dir)) await rm(join(dir, n), { force: true });
      const dur = p.durationSec && p.durationSec > 0 ? p.durationSec : 10;
      await exec(
        "ffmpeg",
        [...base, "-vf", `fps=5/${dur.toFixed(3)},scale=480:-2`, join(dir, "f_%02d.jpg")],
        FFMPEG_TIMEOUT_MS,
      );
      frames = await readFrames(dir);
    }

    const unique = (await dedupeFrames(frames)).slice(0, 5);
    const images: ImageInput[] = unique.map((f) => ({
      kind: "base64",
      mediaType: "image/jpeg",
      data: Buffer.from(f).toString("base64"),
    }));
    return {
      images,
      hasAudio: p.hasAudio,
      ...(p.durationSec !== undefined ? { durationSec: p.durationSec } : {}),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Remove temp dirs left behind by a crashed process. Run at startup. */
export async function sweepTemp(olderThanMs = 10 * 60_000): Promise<number> {
  const root = tmpdir();
  let n = 0;
  try {
    const { stat } = await import("node:fs/promises");
    for (const name of await readdir(root)) {
      if (!/^(dibs-frames-|dibs-ig-)/.test(name)) continue;
      const st = await stat(join(root, name)).catch(() => null);
      if (st && Date.now() - st.mtimeMs > olderThanMs) {
        await rm(join(root, name), { recursive: true, force: true });
        n++;
      }
    }
  } catch {
    /* tmp not readable */
  }
  return n;
}
