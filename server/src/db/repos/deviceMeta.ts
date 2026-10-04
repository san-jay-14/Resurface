import type { PostMeta } from "../../adapters/types.ts";
import type { Queryable } from "../client.ts";
import { json, one } from "../client.ts";

/**
 * Device-submitted (untrusted) metadata. Scoped by userId like every user-owned query: a user only
 * ever reads back their own submission. The one cross-user read is the corroboration COUNT.
 */

export async function insertSubmission(
  q: Queryable,
  s: { userId: string; platform: string; contentId: string; contentHash: string; meta: PostMeta },
): Promise<void> {
  await q.query(
    `insert into device_submissions (platform, content_id, content_hash, user_id, meta)
     values ($1, $2, $3, $4, $5::jsonb)
     on conflict (platform, content_id, content_hash, user_id) do update set meta = excluded.meta`,
    [s.platform, s.contentId, s.contentHash, s.userId, json(s.meta)],
  );
}

/** Distinct users that submitted this exact content hash for this post. */
export async function countConfirmations(
  q: Queryable,
  platform: string,
  contentId: string,
  contentHash: string,
): Promise<number> {
  const r = await one<{ n: number }>(
    q,
    `select count(distinct user_id)::int as n from device_submissions
      where platform = $1 and content_id = $2 and content_hash = $3`,
    [platform, contentId, contentHash],
  );
  return r?.n ?? 0;
}

export async function getOwnSubmission(
  q: Queryable,
  userId: string,
  platform: string,
  contentId: string,
): Promise<PostMeta | null> {
  const r = await one<{ meta: PostMeta }>(
    q,
    `select meta from device_submissions
      where user_id = $1 and platform = $2 and content_id = $3
      order by created_at desc limit 1`,
    [userId, platform, contentId],
  );
  return r?.meta ?? null;
}

/**
 * Corroborated: copy into the shared post cache with provider 'device'. Never displaces a provider
 * row or a fresh negative answer; only fills a gap (no row / error row) or refreshes an older
 * corroborated device row.
 */
export async function promoteToPostCache(
  q: Queryable,
  p: {
    platform: string;
    contentId: string;
    meta: PostMeta;
    contentHash: string;
    expiresAt: Date;
    purgeAfter: Date;
  },
): Promise<boolean> {
  const r = await q.query(
    `insert into post_cache (platform, content_id, status, lock_until, meta, content_hash, provider,
                             fetched_at, expires_at, purge_after)
     values ($1, $2, 'ok', null, $3::jsonb, $4, 'device', now(), $5, $6)
     on conflict (platform, content_id) do update set
       status = 'ok', lock_until = null, meta = excluded.meta, content_hash = excluded.content_hash,
       provider = 'device', fetched_at = now(), expires_at = excluded.expires_at,
       purge_after = excluded.purge_after
     where post_cache.status = 'error' or post_cache.provider = 'device'`,
    [p.platform, p.contentId, json(p.meta), p.contentHash, p.expiresAt, p.purgeAfter],
  );
  return r.rowCount > 0;
}
