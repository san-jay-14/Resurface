import { supabase } from "@/lib/supabase";
import type { Save, SaveCategory, SourcePlatform } from "@/lib/database.types";

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
