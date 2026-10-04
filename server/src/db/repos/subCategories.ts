import type { Queryable, Row } from "../client.ts";

export interface SubCategory extends Row {
  id: string;
  user_id: string;
  category: string;
  name: string;
  emoji: string;
  created_at: Date;
}

const COLS = "id, user_id, category, name, emoji, created_at";

export async function listSubCategories(
  q: Queryable,
  userId: string,
  category: string,
): Promise<SubCategory[]> {
  const r = await q.query<SubCategory>(
    `select ${COLS} from user_sub_categories where user_id = $1 and category = $2 order by created_at`,
    [userId, category],
  );
  return r.rows;
}

export async function createSubCategory(
  q: Queryable,
  userId: string,
  input: { category: string; name: string; emoji: string },
): Promise<SubCategory> {
  const r = await q.query<SubCategory>(
    `insert into user_sub_categories (user_id, category, name, emoji) values ($1, $2, $3, $4)
     returning ${COLS}`,
    [userId, input.category, input.name, input.emoji],
  );
  return r.rows[0]!;
}

export async function deleteSubCategory(
  q: Queryable,
  userId: string,
  id: string,
): Promise<boolean> {
  const r = await q.query("delete from user_sub_categories where id = $1 and user_id = $2", [
    id,
    userId,
  ]);
  return r.rowCount > 0;
}

/** True when the sub-category exists and belongs to the user (guards assigning it to a save). */
export async function ownsSubCategory(q: Queryable, userId: string, id: string): Promise<boolean> {
  const r = await q.query("select 1 from user_sub_categories where id = $1 and user_id = $2", [
    id,
    userId,
  ]);
  return r.rowCount > 0;
}
