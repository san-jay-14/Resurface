import type { PostMeta } from "../../adapters/types.ts";
import type { Queryable, Row } from "../client.ts";
import { json, one } from "../client.ts";

/** Global post cache + analysis cache: "cache the post, not the save". */

export interface CacheRow extends Row {
  platform: string;
  content_id: string;
  status: "fetching" | "ok" | "not_found" | "private" | "error";
  lock_until: Date | null;
  meta: PostMeta | null;
  content_hash: string | null;
  expires_at: Date | null;
  purge_after: Date;
  frames_retry_after: Date | null;
}

export interface SpotRow {
  name: string;
  city: string | null;
  activity: string | null;
  price_hint: string | null;
  best_time: string | null;
  place_id?: string | null;
  lat?: number;
  lng?: number;
  country?: string | null;
  resolved_name?: string | null;
  coords_fetched_at?: string | null;
}

export type ResolvedBy = "caption" | "comments" | "thumbnails" | "frames";

export interface AnalysisRow extends Row {
  platform: string;
  content_id: string;
  category: string | null;
  confidence: number | null;
  spots: SpotRow[] | null;
  resolved_by: ResolvedBy | null;
}

const CACHE_COLS =
  "platform, content_id, status, lock_until, meta, content_hash, expires_at, purge_after, frames_retry_after";

export function getPostCache(
  q: Queryable,
  platform: string,
  contentId: string,
): Promise<CacheRow | null> {
  return one<CacheRow>(
    q,
    `select ${CACHE_COLS} from post_cache where platform = $1 and content_id = $2`,
    [platform, contentId],
  );
}

/** Single-flight lock. 'held' means another worker is fetching this post right now. */
export async function lockPost(
  q: Queryable,
  platform: string,
  contentId: string,
  purgeAfter: Date,
  force: boolean,
): Promise<"acquired" | "held"> {
  const r = await one<{ r: string }>(q, "select post_cache_lock($1, $2, 30, $3, $4) as r", [
    platform,
    contentId,
    purgeAfter,
    force,
  ]);
  return r?.r === "acquired" ? "acquired" : "held";
}

/** Give the lock back without writing a result (transient failure): restore the prior status. */
export async function releaseLock(
  q: Queryable,
  platform: string,
  contentId: string,
): Promise<void> {
  await q.query(
    `update post_cache
        set status = case when meta is not null then 'ok' else 'error' end, lock_until = null
      where platform = $1 and content_id = $2 and status = 'fetching'`,
    [platform, contentId],
  );
}

export async function writeOk(
  q: Queryable,
  row: {
    platform: string;
    contentId: string;
    meta: PostMeta;
    raw: unknown;
    contentHash: string;
    provider: string;
    expiresAt: Date;
    purgeAfter: Date;
  },
): Promise<void> {
  await q.query(
    `insert into post_cache (platform, content_id, status, lock_until, meta, raw, content_hash, provider,
                             fetched_at, expires_at, purge_after)
     values ($1, $2, 'ok', null, $3::jsonb, $4::jsonb, $5, $6, now(), $7, $8)
     on conflict (platform, content_id) do update set
       status = 'ok', lock_until = null, meta = excluded.meta, raw = excluded.raw,
       content_hash = excluded.content_hash, provider = excluded.provider, fetched_at = now(),
       expires_at = excluded.expires_at, purge_after = excluded.purge_after`,
    [
      row.platform,
      row.contentId,
      json(row.meta),
      json(row.raw ?? null),
      row.contentHash,
      row.provider,
      row.expiresAt,
      row.purgeAfter,
    ],
  );
}

export async function writeNegative(
  q: Queryable,
  row: {
    platform: string;
    contentId: string;
    status: "not_found" | "private";
    provider: string;
    expiresAt: Date;
    purgeAfter: Date;
  },
): Promise<void> {
  await q.query(
    `insert into post_cache (platform, content_id, status, lock_until, meta, provider, fetched_at, expires_at, purge_after)
     values ($1, $2, $3, null, null, $4, now(), $5, $6)
     on conflict (platform, content_id) do update set
       status = excluded.status, lock_until = null, meta = null, provider = excluded.provider,
       fetched_at = now(), expires_at = excluded.expires_at, purge_after = excluded.purge_after`,
    [row.platform, row.contentId, row.status, row.provider, row.expiresAt, row.purgeAfter],
  );
}

/** Schema drift: keep the raw provider payload for debugging; stale immediately so it refetches. */
export async function writeDrift(
  q: Queryable,
  row: { platform: string; contentId: string; raw: unknown; provider: string; purgeAfter: Date },
): Promise<void> {
  await q.query(
    `insert into post_cache (platform, content_id, status, lock_until, raw, provider, fetched_at, expires_at, purge_after)
     values ($1, $2, 'error', null, $3::jsonb, $4, now(), now(), $5)
     on conflict (platform, content_id) do update set
       status = 'error', lock_until = null, raw = excluded.raw, provider = excluded.provider,
       fetched_at = now(), expires_at = now()`,
    [row.platform, row.contentId, json(row.raw ?? null), row.provider, row.purgeAfter],
  );
}

/** Merge filtered comments into meta.extras with a TTL stamp. */
export async function saveComments(
  q: Queryable,
  platform: string,
  contentId: string,
  comments: string[],
): Promise<void> {
  await q.query(
    `update post_cache
        set meta = jsonb_set(meta, '{extras}',
              coalesce(meta->'extras', '{}'::jsonb) ||
              jsonb_build_object('comments', $3::jsonb, 'commentsFetchedAt', to_jsonb(now())))
      where platform = $1 and content_id = $2 and meta is not null`,
    [platform, contentId, json(comments)],
  );
}

export async function setFramesRetryAfter(
  q: Queryable,
  platform: string,
  contentId: string,
  at: Date,
): Promise<void> {
  await q.query(
    "update post_cache set frames_retry_after = $3 where platform = $1 and content_id = $2",
    [platform, contentId, at],
  );
}

export function getAnalysis(
  q: Queryable,
  platform: string,
  contentId: string,
  promptVersion: number,
  model: string,
): Promise<AnalysisRow | null> {
  return one<AnalysisRow>(
    q,
    `select platform, content_id, category, confidence, spots, resolved_by from post_analysis
      where platform = $1 and content_id = $2 and prompt_version = $3 and model = $4`,
    [platform, contentId, promptVersion, model],
  );
}

export async function upsertAnalysis(
  q: Queryable,
  row: {
    platform: string;
    contentId: string;
    promptVersion: number;
    model: string;
    category: string;
    confidence: number;
    spots: SpotRow[];
    resolvedBy: ResolvedBy;
  },
): Promise<void> {
  await q.query(
    `insert into post_analysis (platform, content_id, prompt_version, model, category, confidence, spots, resolved_by)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     on conflict (platform, content_id, prompt_version, model) do update set
       category = excluded.category, confidence = excluded.confidence, spots = excluded.spots,
       resolved_by = excluded.resolved_by`,
    [
      row.platform,
      row.contentId,
      row.promptVersion,
      row.model,
      row.category,
      row.confidence,
      json(row.spots),
      row.resolvedBy,
    ],
  );
}

export async function updateAnalysisSpots(
  q: Queryable,
  platform: string,
  contentId: string,
  promptVersion: number,
  model: string,
  spots: SpotRow[],
): Promise<void> {
  await q.query(
    `update post_analysis set spots = $5::jsonb
      where platform = $1 and content_id = $2 and prompt_version = $3 and model = $4`,
    [platform, contentId, promptVersion, model, json(spots)],
  );
}

/** Admin "bypass cache": forget everything cached about one post. */
export async function clearPost(q: Queryable, platform: string, contentId: string): Promise<void> {
  await q.query("delete from post_analysis where platform = $1 and content_id = $2", [
    platform,
    contentId,
  ]);
  await q.query("delete from post_cache where platform = $1 and content_id = $2", [
    platform,
    contentId,
  ]);
}
