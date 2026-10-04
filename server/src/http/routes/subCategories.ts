import { Hono } from "hono";
import { z } from "zod";
import { CATEGORIES } from "../../db/repos/saves.ts";
import {
  createSubCategory,
  deleteSubCategory,
  listSubCategories,
} from "../../db/repos/subCategories.ts";
import { notFound } from "../../errors.ts";
import type { AppEnv, Services } from "../context.ts";
import { jsonBody, pathParams, queryParams } from "../validate.ts";

const category = z.enum(CATEGORIES);

export function subCategoryRoutes(svc: Services): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/sub-categories", async (c) => {
    const { category: cat } = queryParams(c, z.object({ category }));
    return c.json({ sub_categories: await listSubCategories(svc.db, c.get("userId"), cat) });
  });

  r.post("/sub-categories", async (c) => {
    const body = await jsonBody(
      c,
      z
        .object({
          category,
          name: z.string().trim().min(1).max(60),
          emoji: z.string().trim().min(1).max(16).default("📁"),
        })
        .strict(),
    );
    return c.json({ sub_category: await createSubCategory(svc.db, c.get("userId"), body) }, 201);
  });

  r.delete("/sub-categories/:id", async (c) => {
    const { id } = pathParams(c, z.object({ id: z.uuid() }));
    if (!(await deleteSubCategory(svc.db, c.get("userId"), id))) throw notFound("Sub-category");
    return c.body(null, 204);
  });

  return r;
}
