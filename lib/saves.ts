import { supabase } from "@/lib/supabase";
import type { PlaceSave, Save, SaveCategory, SourcePlatform } from "@/lib/database.types";

export interface NewManualSave {
  userId: string;
  category: SaveCategory;
  sourceUrl?: string;
  sourcePlatform: SourcePlatform;
  location?: { placeName: string; city?: string };
}

export interface NewAutoSave {
  userId: string;
  url: string;
  sourcePlatform: SourcePlatform;
}

/** Infer the source platform from a URL (spec §3.2). */
export function detectPlatform(url: string): SourcePlatform {
  if (/instagram\.com/i.test(url)) return "instagram";
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  return "web";
}

/**
 * True for platforms where we can auto-fetch metadata.
 * Instagram is false because no metadata API exists (spec §3.4 note).
 */
export function isAutoPlatform(platform: SourcePlatform): boolean {
  return platform === "youtube" || platform === "web";
}

/** Manual path: category popup save (spec §3.3). */
export async function createManualSave({
  userId,
  category,
  sourceUrl,
  sourcePlatform,
  location,
}: NewManualSave): Promise<Save> {
  const { data, error } = await supabase
    .from("saves")
    .insert({
      user_id: userId,
      category,
      source_url: sourceUrl ?? null,
      source_platform: sourcePlatform,
      status: "manual",
    })
    .select()
    .single();
  if (error) throw error;

  if (location?.placeName) {
    const { error: locError } = await supabase.from("save_locations").insert({
      save_id: data.id,
      place_name: location.placeName,
      city: location.city ?? null,
    });
    if (locError) console.warn("Failed to save location:", locError.message);
  }

  return data as Save;
}

/** Auto path: create a pending save, then kick off enrichment (spec §3.4). */
export async function createPendingSave({
  userId,
  url,
  sourcePlatform,
}: NewAutoSave): Promise<Save> {
  const { data, error } = await supabase
    .from("saves")
    .insert({
      user_id: userId,
      category: "unsorted",
      source_url: url,
      source_platform: sourcePlatform,
      status: "pending",
    })
    .select()
    .single();
  if (error) throw error;
  return data as Save;
}

/**
 * Fire-and-forget: invoke the enrich-save Edge Function.
 * The save is already in the DB; this enriches it asynchronously.
 */
export async function triggerEnrich(saveId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("enrich-save", {
    body: { save_id: saveId },
  });
  if (error) console.warn("Enrich error:", error.message);
}

export interface ScrapedSaveData {
  caption: string;
  hashtags: string[];
  thumbnail_url: string | null;
  owner_username: string | null;
  owner_full_name: string | null;
  owner_profile_pic_url: string | null;
  category: SaveCategory;
  category_confidence: number;
  location: {
    raw_name: string;
    resolved_name: string;
    city: string;
    country: string;
    lat: number;
    lng: number;
    google_place_id: string;
  } | null;
}

/** Creates a save from a successful Instagram auto-scrape. */
export async function createScrapedSave(
  userId: string,
  url: string,
  data: ScrapedSaveData,
): Promise<Save> {
  const { data: save, error } = await supabase
    .from("saves")
    .insert({
      user_id: userId,
      source_url: url,
      source_platform: "instagram",
      category: data.category,
      category_confidence: data.category_confidence,
      caption: data.caption || null,
      keywords: data.hashtags.length > 0 ? data.hashtags : null,
      thumbnail_url: data.thumbnail_url || null,
      source_username: data.owner_username || null,
      scrape_method: "auto",
      status: "enriched",
    })
    .select()
    .single();
  if (error) throw error;

  if (data.location) {
    const { error: locError } = await supabase.from("save_locations").insert({
      save_id: save.id,
      place_name: data.location.resolved_name,
      lat: data.location.lat,
      lng: data.location.lng,
      city: data.location.city,
      country: data.location.country,
      google_place_id: data.location.google_place_id,
    });
    if (locError) console.warn("Failed to save location:", locError.message);
  }

  return save as Save;
}

type RawMapRow = {
  id: string;
  caption: string | null;
  note: string | null;
  thumbnail_url: string | null;
  acted_on: boolean;
  created_at: string;
  source_url: string | null;
  save_locations: {
    place_name: string | null;
    lat: number | null;
    lng: number | null;
    city: string | null;
    google_place_id: string | null;
  };
};

/** Fetches up to 200 Places saves that have a mapped location, for the map view. */
export async function fetchPlacesMapSaves(userId: string): Promise<{
  mapped: PlaceSave[];
  unmappedCount: number;
}> {
  const [mappedRes, allRes] = await Promise.all([
    supabase
      .from("saves")
      .select(
        "id, caption, note, thumbnail_url, acted_on, created_at, source_url, save_locations!inner(place_name, lat, lng, city, google_place_id)",
      )
      .eq("user_id", userId)
      .eq("category", "places")
      .eq("archived", false)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("saves")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("category", "places")
      .eq("archived", false),
  ]);

  const mapped: PlaceSave[] = ((mappedRes.data ?? []) as unknown as RawMapRow[])
    .filter((row) => row.save_locations?.lat != null && row.save_locations?.lng != null)
    .map((row) => ({
      id: row.id,
      caption: row.caption ?? null,
      note: row.note ?? null,
      thumbnail_url: row.thumbnail_url ?? null,
      acted_on: row.acted_on,
      created_at: row.created_at,
      source_url: row.source_url ?? null,
      location_name: row.save_locations.place_name ?? "Unnamed place",
      location_city: row.save_locations.city ?? null,
      lat: row.save_locations.lat!,
      lng: row.save_locations.lng!,
      google_place_id: row.save_locations.google_place_id ?? null,
    }));

  const totalPlaces = allRes.count ?? 0;
  const unmappedCount = Math.max(0, totalPlaces - mapped.length);

  return { mapped, unmappedCount };
}
