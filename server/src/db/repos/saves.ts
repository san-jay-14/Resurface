import type { Queryable, Row } from "../client.ts";
import { json, one } from "../client.ts";

export const CATEGORIES = [
  "places",
  "recipes",
  "fashion",
  "shopping",
  "watch_learn",
  "inspo",
  "unsorted",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SOURCE_PLATFORMS = [
  "instagram",
  "web",
  "youtube",
  "whatsapp",
  "tiktok",
  "pinterest",
  "twitter",
  "linkedin",
  "unsorted",
] as const;
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];

export interface SaveRow extends Row {
  id: string;
  user_id: string;
  source_platform: SourcePlatform;
  source_url: string | null;
  platform: string | null;
  content_id: string | null;
  category: Category;
  title: string | null;
  note: string | null;
  caption: string | null;
  ai_description: string | null;
  keywords: string[] | null;
  thumbnail_url: string | null;
  source_username: string | null;
  status: "pending" | "enriched" | "manual";
  enrichment_status: "queued" | "processing" | "done" | "needs_review" | null;
  enrichment_reason: string | null;
  enriched_at: Date | null;
  scrape_method: string;
  category_confidence: string | null;
  acted_on: boolean;
  acted_on_at: Date | null;
  is_favorite: boolean;
  archived: boolean;
  archived_at: Date | null;
  last_viewed_at: Date | null;
  last_interacted_at: Date | null;
  remind_at: Date | null;
  reminded_at: Date | null;
  sub_category_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const COL_NAMES = [
  "id",
  "user_id",
  "source_platform",
  "source_url",
  "platform",
  "content_id",
  "category",
  "title",
  "note",
  "caption",
  "ai_description",
  "keywords",
  "thumbnail_url",
  "source_username",
  "status",
  "enrichment_status",
  "enrichment_reason",
  "enriched_at",
  "scrape_method",
  "category_confidence",
  "acted_on",
  "acted_on_at",
  "is_favorite",
  "archived",
  "archived_at",
  "last_viewed_at",
  "last_interacted_at",
  "remind_at",
  "reminded_at",
  "sub_category_id",
  "created_at",
  "updated_at",
] as const;
/** Column list qualified with the `s` alias, and unqualified for INSERT ... RETURNING. */
const COLS = COL_NAMES.map((c) => `s.${c}`).join(", ");
const BARE_COLS = COL_NAMES.join(", ");

/** The subset of a save that other members of a shared board may see (no personal notes/state). */
export const PUBLIC_SAVE_COLUMNS = [
  "id",
  "user_id",
  "source_platform",
  "source_url",
  "category",
  "title",
  "caption",
  "ai_description",
  "keywords",
  "thumbnail_url",
  "source_username",
  "created_at",
] as const;

/** Escape LIKE wildcards in user input so it matches literally. */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export interface ListSavesFilter {
  category?: Category;
  archived: "true" | "false" | "any";
  actedOn?: boolean;
  search?: string;
  updatedSince?: Date;
  before?: Date;
  ids?: string[];
  order: "asc" | "desc";
  limit: number;
}

export async function listSaves(
  q: Queryable,
  userId: string,
  f: ListSavesFilter,
): Promise<SaveRow[]> {
  const where = ["s.user_id = $1"];
  const params: unknown[] = [userId];
  const add = (cond: string, value: unknown) => {
    params.push(value);
    where.push(cond.replaceAll("?", `$${params.length}`));
  };
  if (f.category) add("s.category = ?", f.category);
  if (f.archived !== "any") add("s.archived = ?", f.archived === "true");
  if (f.actedOn !== undefined) add("s.acted_on = ?", f.actedOn);
  if (f.updatedSince) add("s.updated_at > ?", f.updatedSince);
  if (f.before) add("s.created_at < ?", f.before);
  if (f.ids?.length) add("s.id = any(?::uuid[])", f.ids);
  if (f.search) {
    add(
      `(s.title ilike ? escape '\\' or s.ai_description ilike ? escape '\\'
         or s.note ilike ? escape '\\' or s.caption ilike ? escape '\\')`,
      `%${escapeLike(f.search)}%`,
    );
  }
  // The search predicate above reuses one placeholder for all four columns.
  const dir = f.order === "asc" ? "asc" : "desc";
  params.push(f.limit);
  const r = await q.query<SaveRow>(
    `select ${COLS} from saves s where ${where.join(" and ")}
     order by s.created_at ${dir}, s.id ${dir} limit $${params.length}`,
    params,
  );
  return r.rows;
}

export async function categoryCounts(
  q: Queryable,
  userId: string,
): Promise<Record<string, number>> {
  const r = await q.query<{ category: string; n: number }>(
    `select category, count(*)::int as n from saves
      where user_id = $1 and archived = false group by category`,
    [userId],
  );
  return Object.fromEntries(r.rows.map((row) => [row.category, row.n]));
}

export interface SaveLocation extends Row {
  id: string;
  save_id: string;
  place_name: string | null;
  lat: number | null;
  lng: number | null;
  city: string | null;
  country: string | null;
  google_place_id: string | null;
}

export async function getLocation(q: Queryable, saveId: string): Promise<SaveLocation | null> {
  return one<SaveLocation>(
    q,
    `select id, save_id, place_name, lat, lng, city, country, google_place_id
       from save_locations where save_id = $1`,
    [saveId],
  );
}

/**
 * A save the user can see: their own, or one that belongs to a board they are a member of.
 * Returns `owned` so callers can strip personal fields from someone else's save.
 */
export async function getVisibleSave(
  q: Queryable,
  userId: string,
  saveId: string,
): Promise<{ save: SaveRow; owned: boolean } | null> {
  const save = await one<SaveRow>(
    q,
    `select ${COLS} from saves s
      where s.id = $2
        and (s.user_id = $1
             or exists (select 1 from collection_saves cs
                          join collection_members m on m.collection_id = cs.collection_id
                         where cs.save_id = s.id and m.user_id = $1))`,
    [userId, saveId],
  );
  return save ? { save, owned: save.user_id === userId } : null;
}

export function toPublicSave(save: SaveRow): Partial<SaveRow> {
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_SAVE_COLUMNS) out[k] = save[k];
  return out;
}

export interface SavePatch {
  is_favorite?: boolean;
  acted_on?: boolean;
  note?: string | null;
  remind_at?: string | null;
  reminded_at?: string | null;
  category?: Category;
  sub_category_id?: string | null;
  title?: string | null;
  last_viewed_at?: boolean; // true => now()
}

/** Update a save the user OWNS. Returns null if it does not exist or belongs to someone else. */
export async function updateSave(
  q: Queryable,
  userId: string,
  saveId: string,
  patch: SavePatch,
): Promise<SaveRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [userId, saveId];
  const set = (col: string, value: unknown, cast = "") => {
    params.push(value);
    sets.push(`${col} = $${params.length}${cast}`);
  };

  if (patch.is_favorite !== undefined) set("is_favorite", patch.is_favorite);
  if (patch.acted_on !== undefined) {
    set("acted_on", patch.acted_on);
    sets.push(patch.acted_on ? "acted_on_at = now()" : "acted_on_at = null");
  }
  if ("note" in patch) set("note", patch.note ?? null);
  if ("remind_at" in patch) set("remind_at", patch.remind_at ?? null, "::timestamptz");
  if ("reminded_at" in patch) set("reminded_at", patch.reminded_at ?? null, "::timestamptz");
  if (patch.category !== undefined) set("category", patch.category);
  if ("sub_category_id" in patch) set("sub_category_id", patch.sub_category_id ?? null);
  if ("title" in patch) set("title", patch.title ?? null);
  if (patch.last_viewed_at) sets.push("last_viewed_at = now()");
  if (sets.length === 0) {
    return one<SaveRow>(
      q,
      `select ${COLS} from saves s where s.id = $2 and s.user_id = $1`,
      params,
    );
  }
  // Viewing a save is not an "interaction"; everything else is.
  if (Object.keys(patch).some((k) => k !== "last_viewed_at"))
    sets.push("last_interacted_at = now()");

  return one<SaveRow>(
    q,
    `update saves s set ${sets.join(", ")} where s.id = $2 and s.user_id = $1 returning ${COLS}`,
    params,
  );
}

export interface NewManualSave {
  source_url: string | null;
  source_platform: SourcePlatform;
  category: Category;
  location?: { place_name: string; city?: string | null } | undefined;
}

export async function createManualSave(
  q: Queryable,
  userId: string,
  input: NewManualSave,
): Promise<SaveRow> {
  const save = await one<SaveRow>(
    q,
    `insert into saves (user_id, source_url, source_platform, category, status)
     values ($1, $2, $3, $4, 'manual')
     returning ${BARE_COLS}`,
    [userId, input.source_url, input.source_platform, input.category],
  );
  if (!save) throw new Error("insert returned no row");
  if (input.location?.place_name) {
    await q.query(
      `insert into save_locations (save_id, place_name, city) values ($1, $2, $3)
       on conflict (save_id) do update set place_name = excluded.place_name, city = excluded.city`,
      [save.id, input.location.place_name, input.location.city ?? null],
    );
  }
  return save;
}

/** Same-category saves for the "more like this" strip (own saves only). */
export async function similarSaves(
  q: Queryable,
  userId: string,
  saveId: string,
  category: Category,
  limit = 10,
): Promise<SaveRow[]> {
  const r = await q.query<SaveRow>(
    `select ${COLS} from saves s
      where s.user_id = $1 and s.category = $2 and s.archived = false and s.id <> $3
      order by s.created_at desc limit $4`,
    [userId, category, saveId, limit],
  );
  return r.rows;
}

// ---------------------------------------------------------------------------
// Archive (soft delete with a 30-day restore window). Every multi-step change is one transaction.
// ---------------------------------------------------------------------------

export interface ArchivedRow extends Row {
  id: string;
  user_id: string;
  original_save_id: string;
  original_data: Record<string, unknown>;
  archived_at: Date;
  expires_at: Date;
}

export async function archiveSave(
  db: { tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> },
  userId: string,
  saveId: string,
): Promise<ArchivedRow | null> {
  return db.tx(async (q) => {
    const save = await one<SaveRow>(
      q,
      `select ${COLS} from saves s where s.id = $2 and s.user_id = $1 and s.archived = false for update`,
      [userId, saveId],
    );
    if (!save) return null;
    await q.query(
      `update saves set archived = true, archived_at = now(), last_interacted_at = now() where id = $1`,
      [saveId],
    );
    return one<ArchivedRow>(
      q,
      `insert into archived_saves (user_id, original_save_id, original_data) values ($1, $2, $3::jsonb)
       returning id, user_id, original_save_id, original_data, archived_at, expires_at`,
      [userId, saveId, json(save)],
    );
  });
}

export async function listArchived(q: Queryable, userId: string): Promise<ArchivedRow[]> {
  const r = await q.query<ArchivedRow>(
    `select id, user_id, original_save_id, original_data, archived_at, expires_at
       from archived_saves where user_id = $1 order by archived_at desc`,
    [userId],
  );
  return r.rows;
}

export async function restoreArchived(
  db: { tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> },
  userId: string,
  archivedId: string,
): Promise<boolean> {
  return db.tx(async (q) => {
    const a = await one<{ original_save_id: string }>(
      q,
      "delete from archived_saves where id = $1 and user_id = $2 returning original_save_id",
      [archivedId, userId],
    );
    if (!a) return false;
    await q.query(
      `update saves set archived = false, archived_at = null where id = $1 and user_id = $2`,
      [a.original_save_id, userId],
    );
    return true;
  });
}

/** Permanently delete an archived save and its archive record. */
export async function deleteArchived(
  db: { tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> },
  userId: string,
  archivedId: string,
): Promise<boolean> {
  return db.tx(async (q) => {
    const a = await one<{ original_save_id: string }>(
      q,
      "delete from archived_saves where id = $1 and user_id = $2 returning original_save_id",
      [archivedId, userId],
    );
    if (!a) return false;
    await q.query("delete from saves where id = $1 and user_id = $2", [a.original_save_id, userId]);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Map / location queries
// ---------------------------------------------------------------------------

export interface PlaceSave extends Row {
  id: string;
  caption: string | null;
  note: string | null;
  thumbnail_url: string | null;
  acted_on: boolean;
  created_at: Date;
  source_url: string | null;
  location_name: string;
  location_city: string | null;
  lat: number;
  lng: number;
  google_place_id: string | null;
}

const PLACE_COLS = `s.id, s.caption, s.note, s.thumbnail_url, s.acted_on, s.created_at, s.source_url,
  coalesce(l.place_name, 'Unnamed place') as location_name, l.city as location_city,
  l.lat, l.lng, l.google_place_id`;

/** Up to 200 of the user's saves in a category that have coordinates, plus how many do not. */
export async function mapSavesForCategory(
  q: Queryable,
  userId: string,
  category: Category,
): Promise<{ mapped: PlaceSave[]; unmapped_count: number }> {
  const mapped = await q.query<PlaceSave>(
    `select ${PLACE_COLS} from saves s join save_locations l on l.save_id = s.id
      where s.user_id = $1 and s.category = $2 and s.archived = false
        and l.lat is not null and l.lng is not null
      order by s.created_at desc limit 200`,
    [userId, category],
  );
  const total = await one<{ n: number }>(
    q,
    `select count(*)::int as n from saves where user_id = $1 and category = $2 and archived = false`,
    [userId, category],
  );
  return {
    mapped: mapped.rows,
    unmapped_count: Math.max(0, (total?.n ?? 0) - mapped.rows.length),
  };
}

/** Candidate saves in a city for the "you've arrived" local notification (own saves only). */
export async function savesInCity(
  q: Queryable,
  userId: string,
  city: string,
  categories: Category[],
  limit = 5,
): Promise<Pick<SaveRow, "id" | "title" | "ai_description" | "caption">[]> {
  const r = await q.query<Pick<SaveRow, "id" | "title" | "ai_description" | "caption">>(
    `select s.id, s.title, s.ai_description, s.caption
       from saves s join save_locations l on l.save_id = s.id
      where s.user_id = $1 and s.acted_on = false and s.archived = false
        and s.category = any($3::text[]) and lower(l.city) like lower($2) escape '\\'
      order by s.is_favorite desc, s.created_at desc limit $4`,
    [userId, `%${escapeLike(city)}%`, categories, limit],
  );
  return r.rows;
}

export interface ActivityFeed {
  saves: SaveRow[];
  board_adds: { save_id: string; added_at: Date; board_name: string }[];
}

/** Recent saves plus when they were filed into boards (merged client-side into one feed). */
export async function activityFeed(
  q: Queryable,
  userId: string,
  limit = 150,
): Promise<ActivityFeed> {
  const saves = await listSaves(q, userId, { archived: "false", order: "desc", limit });
  if (saves.length === 0) return { saves, board_adds: [] };
  const adds = await q.query<{ save_id: string; added_at: Date; board_name: string }>(
    `select cs.save_id, cs.added_at, c.name as board_name
       from collection_saves cs join collections c on c.id = cs.collection_id
      where cs.save_id = any($1::uuid[]) and c.owner_id = $2
      order by cs.added_at desc`,
    [saves.map((s) => s.id), userId],
  );
  return { saves, board_adds: adds.rows };
}
