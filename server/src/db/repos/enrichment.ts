import type { PostMeta } from "../../adapters/types.ts";
import { LABEL_TO_CATEGORY } from "../../config.ts";
import type { Db, Queryable, Row } from "../client.ts";
import { one } from "../client.ts";
import type { SpotRow } from "./pipelineCache.ts";

/**
 * Pipeline <-> saves boundary. Every write is guarded by `enrichment_status` so a retry can never
 * clobber a save the user has since edited by hand or one that already finished.
 */
const OPEN = ["queued", "processing"];

export interface FinalizeInput {
  category: string; // classifier label ("Watch/Learn") or stored value
  confidence: number;
  meta: PostMeta | null;
  spots: SpotRow[];
}

export async function finalizeSave(
  db: Db,
  saveId: string,
  a: FinalizeInput,
): Promise<{ updated: boolean; located: boolean }> {
  const category = (LABEL_TO_CATEGORY as Record<string, string>)[a.category] ?? a.category;
  const m = a.meta;
  const mirrored = m?.extras.mirroredThumbnail as string | undefined;

  return db.tx(async (q) => {
    const r = await q.query(
      `update saves set
         category = $2, category_confidence = $3, caption = $4, keywords = $5::text[],
         thumbnail_url = $6, source_username = $7, scrape_method = 'auto', status = 'enriched',
         enrichment_status = 'done', enrichment_reason = null, enriched_at = now()
       where id = $1 and enrichment_status = any($8::text[])`,
      [
        saveId,
        category,
        a.confidence,
        m?.text ?? null,
        m?.hashtags?.length ? m.hashtags : null,
        mirrored ?? m?.thumbnailUrl ?? null,
        m?.author?.handle ?? null,
        OPEN,
      ],
    );
    const updated = r.rowCount > 0;

    const spot = a.spots.find((s) => s.lat != null && s.lng != null);
    if (updated && spot) {
      await q.query(
        `insert into save_locations (save_id, place_name, lat, lng, city, country, google_place_id)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (save_id) do update set place_name = excluded.place_name, lat = excluded.lat,
           lng = excluded.lng, city = excluded.city, country = excluded.country,
           google_place_id = excluded.google_place_id`,
        [
          saveId,
          spot.resolved_name ?? spot.name,
          spot.lat,
          spot.lng,
          spot.city ?? null,
          spot.country ?? null,
          spot.place_id ?? null,
        ],
      );
      return { updated, located: true };
    }
    return { updated, located: false };
  });
}

export async function markNeedsReview(
  q: Queryable,
  saveId: string,
  reason: string,
  meta?: PostMeta | null,
): Promise<void> {
  // Show whatever we did learn so the user sees a thumbnail while categorising by hand.
  // status 'manual' ends the app's "Sorting" overlay and hands the save back to the user.
  // Last resort (the "visual" fallback): the user's OWN device submission for this post, if any,
  // supplies a thumbnail/handle when no provider did. It never leaves this user's row.
  await q.query(
    `update saves s set enrichment_status = 'needs_review', enrichment_reason = $2, status = 'manual',
            caption = coalesce($3, s.caption),
            thumbnail_url = coalesce($4, s.thumbnail_url, d.meta->>'thumbnailUrl'),
            source_username = coalesce($5, s.source_username, d.meta->'author'->>'handle')
       from (select $1::uuid as id) k
       left join lateral (
         select ds.meta from device_submissions ds
           join saves s2 on s2.id = k.id
          where ds.user_id = s2.user_id and ds.platform = s2.platform and ds.content_id = s2.content_id
          order by ds.created_at desc limit 1
       ) d on true
      where s.id = k.id and s.enrichment_status = any($6::text[])`,
    [
      saveId,
      reason,
      meta?.text ?? null,
      (meta?.extras.mirroredThumbnail as string | undefined) ?? meta?.thumbnailUrl ?? null,
      meta?.author?.handle ?? null,
      OPEN,
    ],
  );
}

export interface EnqueuedSave extends Row {
  id: string;
  enrichment_status: string | null;
}

/**
 * Find-or-create the save for (user, platform, content_id). Idempotent: sharing the same post twice
 * returns the existing save, and a concurrent duplicate request resolves to the same row.
 */
export async function findOrCreateSave(
  db: Db,
  userId: string,
  s: { platform: string; contentId: string; sourceUrl: string },
): Promise<{ id: string; created: boolean }> {
  const created = await one<{ id: string }>(
    db,
    `insert into saves (user_id, platform, content_id, source_platform, source_url, category, status, enrichment_status)
     values ($1, $2, $3, $2, $4, 'unsorted', 'pending', 'queued')
     on conflict (user_id, platform, content_id) do nothing
     returning id`,
    [userId, s.platform, s.contentId, s.sourceUrl],
  );
  if (created) return { id: created.id, created: true };
  const existing = await one<{ id: string }>(
    db,
    "select id from saves where user_id = $1 and platform = $2 and content_id = $3",
    [userId, s.platform, s.contentId],
  );
  if (!existing) throw new Error("save vanished during find-or-create");
  return { id: existing.id, created: false };
}

export async function countRecentSaves(
  q: Queryable,
  userId: string,
  windowSeconds: number,
): Promise<number> {
  const r = await one<{ n: number }>(
    q,
    `select count(*)::int as n from saves where user_id = $1 and created_at > now() - make_interval(secs => $2)`,
    [userId, windowSeconds],
  );
  return r?.n ?? 0;
}
