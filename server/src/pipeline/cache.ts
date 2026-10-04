import type { PlatformAdapter, PostMeta } from "../adapters/types.ts";
import { assertPublicUrl } from "../adapters/ssrf.ts";
import type { CacheRow } from "../db/repos/pipelineCache.ts";
import { sha256Hex } from "../util.ts";
import type { PipelineContext } from "./context.ts";

/** Freshness rules over a post_cache row. */
const DAY = 86_400_000;

export const addDays = (from: Date, days: number): Date => new Date(from.getTime() + days * DAY);
export const addHours = (from: Date, hours: number): Date =>
  new Date(from.getTime() + hours * 3_600_000);

export const isFreshOk = (r: CacheRow | null, now: Date): r is CacheRow & { meta: PostMeta } =>
  !!r && r.status === "ok" && !!r.meta && !!r.expires_at && r.expires_at.getTime() > now.getTime();

export const isNegativeFresh = (
  r: CacheRow | null,
  now: Date,
): r is CacheRow & { status: "not_found" | "private" } =>
  !!r &&
  (r.status === "not_found" || r.status === "private") &&
  !!r.expires_at &&
  r.expires_at.getTime() > now.getTime();

/** Stale-but-retained meta (past expires_at, before purge_after): served while a breaker is open. */
export const staleMeta = (r: CacheRow | null, now: Date): PostMeta | null =>
  r?.meta && r.purge_after.getTime() > now.getTime() ? r.meta : null;

export function cachedComments(meta: PostMeta, ttlDays: number, now: Date): string[] | null {
  const at = meta.extras.commentsFetchedAt as string | undefined;
  const c = meta.extras.comments as string[] | undefined;
  if (!at || !c || ttlDays <= 0) return null;
  return now.getTime() - new Date(at).getTime() < ttlDays * DAY ? c : null;
}

export const contentHash = (m: PostMeta): string => sha256Hex(`${m.title ?? ""}\n${m.text ?? ""}`);

/**
 * Platform CDN thumbnails (Instagram) are signed and expire, so copy to object storage at ingest.
 * Returns null when storage is not configured. Throws on failure (caller treats it as soft).
 * NOTE: stored as-is (no ~480px webp re-encode).
 */
export async function mirrorThumbnail(
  ctx: Pick<PipelineContext, "storage" | "fetch" | "resolveDns">,
  meta: PostMeta,
  _adapter?: PlatformAdapter,
): Promise<string | null> {
  if (!ctx.storage || !meta.thumbnailUrl) return null;
  const u = new URL(meta.thumbnailUrl);
  await assertPublicUrl(u, ctx.resolveDns);
  const resp = await ctx.fetch(u, { redirect: "error", signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`thumbnail http ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  if (buf.byteLength > 5_000_000) throw new Error("thumbnail too large");
  const type = resp.headers.get("content-type") ?? "image/jpeg";
  const ext = type.includes("webp") ? "webp" : type.includes("png") ? "png" : "jpg";
  const key = `thumbs/${meta.platform}/${meta.contentId}.${ext}`;
  await ctx.storage.put(key, buf, type, { cacheControl: "public, max-age=31536000, immutable" });
  return ctx.storage.publicUrl(key);
}
