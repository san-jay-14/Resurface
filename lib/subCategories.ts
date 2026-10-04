import { api } from "@/lib/api";
import type { SaveCategory, UserSubCategory } from "./database.types";

export async function listSubCategories(category: SaveCategory): Promise<UserSubCategory[]> {
  const { sub_categories } = await api.get<{ sub_categories: UserSubCategory[] }>(
    "/sub-categories",
    { category },
  );
  return sub_categories;
}

export async function createSubCategory(
  category: SaveCategory,
  name: string,
  emoji?: string,
): Promise<UserSubCategory> {
  const { sub_category } = await api.post<{ sub_category: UserSubCategory }>("/sub-categories", {
    category,
    name,
    ...(emoji ? { emoji } : {}),
  });
  return sub_category;
}

export const deleteSubCategory = (id: string) => api.delete(`/sub-categories/${id}`);
