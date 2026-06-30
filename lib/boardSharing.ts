import type { Collection, SaveCategory } from "./database.types";
import { supabase } from "./supabase";

/** Generates an 8-char invite code (excludes ambiguous chars I/O/0/1). */
function randomInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/** Marks an existing collection as shared, generating an invite code if it
 *  doesn't already have one. */
export async function shareCollection(collectionId: string, ownerId: string): Promise<Collection> {
  const code = randomInviteCode();
  const { data, error } = await supabase
    .from("collections")
    .update({ is_shared: true, invite_code: code, owner_id: ownerId })
    .eq("id", collectionId)
    .select()
    .single();
  if (error) throw error;
  return data as Collection;
}

/**
 * Category boards (Places, Recipes, ...) aren't real `collections` rows —
 * they're just saves grouped by `category`. To share one, we find-or-create
 * a "shadow" collection for that category (tracked via `source_category`),
 * sync the user's current saves into it, and share that.
 */
export async function getOrCreateCategoryShareCollection(
  userId: string,
  category: SaveCategory,
  label: string,
): Promise<Collection> {
  const { data: existing } = await supabase
    .from("collections")
    .select("*")
    .eq("user_id", userId)
    .eq("source_category", category)
    .maybeSingle();

  let collection = existing as Collection | null;

  if (!collection) {
    const { data, error } = await supabase
      .from("collections")
      .insert({ user_id: userId, name: label, source_category: category })
      .select()
      .single();
    if (error) throw error;
    collection = data as Collection;
  }

  const { data: categorySaves } = await supabase
    .from("saves")
    .select("id")
    .eq("user_id", userId)
    .eq("category", category)
    .eq("archived", false);

  if (categorySaves && categorySaves.length > 0) {
    await supabase
      .from("collection_saves")
      .upsert(
        categorySaves.map((s) => ({ collection_id: collection!.id, save_id: s.id as string })),
        { onConflict: "collection_id,save_id", ignoreDuplicates: true },
      );
  }

  if (!collection.is_shared || !collection.invite_code) {
    collection = await shareCollection(collection.id, userId);
  }

  return collection;
}
