import { supabase } from "@/lib/supabase";
import type { Collection } from "@/lib/database.types";

export async function getCollections(userId: string): Promise<Collection[]> {
  const { data, error } = await supabase
    .from("collections")
    .select("*")
    .eq("user_id", userId)
    .order("name");
  if (error) throw error;
  return (data ?? []) as Collection[];
}

export async function createCollection(userId: string, name: string): Promise<Collection> {
  const { data, error } = await supabase
    .from("collections")
    .insert({ user_id: userId, name: name.trim() })
    .select()
    .single();
  if (error) throw error;
  return data as Collection;
}

export async function deleteCollection(collectionId: string): Promise<void> {
  const { error } = await supabase.from("collections").delete().eq("id", collectionId);
  if (error) throw error;
}

export async function addSaveToCollection(collectionId: string, saveId: string): Promise<void> {
  const { error } = await supabase
    .from("collection_saves")
    .insert({ collection_id: collectionId, save_id: saveId });
  if (error && !error.message.includes("duplicate")) throw error;
}

export async function removeSaveFromCollection(collectionId: string, saveId: string): Promise<void> {
  const { error } = await supabase
    .from("collection_saves")
    .delete()
    .eq("collection_id", collectionId)
    .eq("save_id", saveId);
  if (error) throw error;
}

export async function getSaveCollectionIds(saveId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("collection_saves")
    .select("collection_id")
    .eq("save_id", saveId);
  if (error) throw error;
  return (data ?? []).map((r) => r.collection_id);
}
