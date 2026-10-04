import { api } from "@/lib/api";
import type {
  ArchivedSave,
  PlaceSave,
  Save,
  SaveCategory,
  SaveLocation,
  SourcePlatform,
} from "@/lib/database.types";

export interface NewManualSave {
  category: SaveCategory;
  sourceUrl?: string;
  sourcePlatform: SourcePlatform;
  location?: { placeName: string; city?: string };
}

/** Infer the source platform from a URL (spec §3.2). */
export function detectPlatform(url: string): SourcePlatform {
  if (/instagram\.com/i.test(url)) return "instagram";
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  return "web";
}

export interface ListSavesParams {
  category?: SaveCategory;
  archived?: boolean | "any";
  actedOn?: boolean;
  search?: string;
  updatedSince?: string;
  before?: string;
  ids?: string[];
  order?: "asc" | "desc";
  limit?: number;
}

export async function listSaves(p: ListSavesParams = {}): Promise<Save[]> {
  const { saves } = await api.get<{ saves: Save[] }>("/saves", {
    category: p.category,
    archived: p.archived === undefined ? undefined : String(p.archived),
    acted_on: p.actedOn,
    q: p.search,
    updated_since: p.updatedSince,
    before: p.before,
    ids: p.ids?.join(","),
    order: p.order,
    limit: p.limit,
  });
  return saves;
}

/** Number of live saves per category, in a single call. */
export async function getCategoryCounts(): Promise<Partial<Record<SaveCategory, number>>> {
  const { counts } = await api.get<{ counts: Partial<Record<SaveCategory, number>> }>(
    "/saves/counts",
  );
  return counts;
}

export interface SaveDetail {
  save: Save;
  location: SaveLocation | null;
  board_ids: string[];
  owned: boolean;
}

export const getSave = (id: string) => api.get<SaveDetail>(`/saves/${id}`);

export async function getSimilarSaves(id: string): Promise<Save[]> {
  const { saves } = await api.get<{ saves: Save[] }>(`/saves/${id}/similar`);
  return saves;
}

export interface SavePatch {
  is_favorite?: boolean;
  acted_on?: boolean;
  note?: string | null;
  remind_at?: string | null;
  reminded_at?: string | null;
  category?: SaveCategory;
  sub_category_id?: string | null;
  title?: string | null;
  /** Stamp `last_viewed_at` server-side. */
  viewed?: true;
}

export async function updateSave(id: string, patch: SavePatch): Promise<Save> {
  const { save } = await api.patch<{ save: Save }>(`/saves/${id}`, patch);
  return save;
}

/**
 * Hand the shared URL to the pipeline: the server canonicalizes it and creates the save plus one
 * fetch job (idempotent: sharing the same post twice never duplicates). Results arrive on the save
 * row, so callers poll `listSaves({ updatedSince })` while saves are pending.
 * Throws an ApiError when the server rejects the URL, so the caller can fall back to manual.
 */
export async function enqueueSave(url: string): Promise<{ saveId: string; created: boolean }> {
  const r = await api.post<{ save_id: string; created: boolean }>("/saves/enqueue", { url });
  return { saveId: r.save_id, created: r.created };
}

/** Manual path: category popup save (spec §3.3). */
export async function createManualSave(input: NewManualSave): Promise<Save> {
  const { save } = await api.post<{ save: Save }>("/saves/manual", {
    category: input.category,
    source_url: input.sourceUrl ?? null,
    source_platform: input.sourcePlatform,
    ...(input.location?.placeName
      ? { location: { place_name: input.location.placeName, city: input.location.city ?? null } }
      : {}),
  });
  return save;
}

/** Move a save to the archive (restorable for 30 days). */
export async function archiveSave(id: string): Promise<void> {
  await api.post(`/saves/${id}/archive`);
}

export async function listArchived(): Promise<ArchivedSave[]> {
  const { archived } = await api.get<{ archived: ArchivedSave[] }>("/archived");
  return archived;
}

export const restoreArchived = (id: string) => api.post(`/archived/${id}/restore`);
export const deleteArchived = (id: string) => api.delete(`/archived/${id}`);

export interface MapResult {
  mapped: PlaceSave[];
  unmappedCount: number;
}

/** A category's saves that have coordinates (up to 200), plus how many do not. */
export async function fetchPlacesMapSaves(category: SaveCategory = "places"): Promise<MapResult> {
  const r = await api.get<{ mapped: PlaceSave[]; unmapped_count: number }>("/saves/map", {
    category,
  });
  return { mapped: r.mapped, unmappedCount: r.unmapped_count };
}

export interface ActivityFeed {
  saves: Save[];
  board_adds: { save_id: string; added_at: string; board_name: string }[];
}

export const getActivityFeed = () => api.get<ActivityFeed>("/activity");

/** Un-acted-on saves in a city, for the "you've arrived" local notification. */
export async function listSavesInCity(
  city: string,
  categories: SaveCategory[] = ["places"],
): Promise<Save[]> {
  const { saves } = await api.get<{ saves: Save[] }>("/saves/city", {
    city,
    categories: categories.join(","),
  });
  return saves;
}
