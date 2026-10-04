import { Hono } from "hono";
import { z } from "zod";
import { boardIdsForSave } from "../../db/repos/boards.ts";
import {
  CATEGORIES,
  SOURCE_PLATFORMS,
  activityFeed,
  archiveSave,
  categoryCounts,
  createManualSave,
  deleteArchived,
  getLocation,
  getVisibleSave,
  listArchived,
  listSaves,
  mapSavesForCategory,
  restoreArchived,
  savesInCity,
  similarSaves,
  toPublicSave,
  updateSave,
} from "../../db/repos/saves.ts";
import { ownsSubCategory } from "../../db/repos/subCategories.ts";
import { badRequest, notFound } from "../../errors.ts";
import type { AppEnv, Services } from "../context.ts";
import { jsonBody, pathParams, queryParams } from "../validate.ts";

const category = z.enum(CATEGORIES);
const idParam = z.object({ id: z.uuid() });
const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const boolString = z.enum(["true", "false"]).transform((v) => v === "true");

const listQuery = z.object({
  category: category.optional(),
  archived: z.enum(["true", "false", "any"]).default("false"),
  acted_on: boolString.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  updated_since: isoDate.optional(),
  before: isoDate.optional(),
  ids: z
    .string()
    .transform((s) => s.split(",").filter(Boolean))
    .pipe(z.array(z.uuid()).max(100))
    .optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const httpUrl = z
  .string()
  .max(2048)
  .refine((s) => /^https?:\/\//i.test(s), "Must be an http(s) URL");

const manualSchema = z
  .object({
    category,
    source_url: httpUrl.nullable().optional(),
    source_platform: z.enum(SOURCE_PLATFORMS),
    location: z
      .object({
        place_name: z.string().trim().min(1).max(200),
        city: z.string().trim().max(120).nullable().optional(),
      })
      .optional(),
  })
  .strict();

const isoOrNull = z.iso.datetime({ offset: true }).nullable();

const patchSchema = z
  .object({
    is_favorite: z.boolean(),
    acted_on: z.boolean(),
    note: z.string().max(2000).nullable(),
    remind_at: isoOrNull,
    reminded_at: isoOrNull,
    category,
    sub_category_id: z.uuid().nullable(),
    title: z.string().trim().max(300).nullable(),
    viewed: z.literal(true),
  })
  .partial()
  .strict();

export function saveRoutes(svc: Services): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const { db } = svc;

  r.get("/saves", async (c) => {
    const f = queryParams(c, listQuery);
    const saves = await listSaves(db, c.get("userId"), {
      archived: f.archived,
      order: f.order,
      limit: f.limit,
      ...(f.category ? { category: f.category } : {}),
      ...(f.acted_on !== undefined ? { actedOn: f.acted_on } : {}),
      ...(f.q ? { search: f.q } : {}),
      ...(f.updated_since ? { updatedSince: f.updated_since } : {}),
      ...(f.before ? { before: f.before } : {}),
      ...(f.ids ? { ids: f.ids } : {}),
    });
    return c.json({ saves });
  });

  r.get("/saves/counts", async (c) =>
    c.json({ counts: await categoryCounts(db, c.get("userId")) }),
  );

  r.get("/saves/map", async (c) => {
    const { category: cat } = queryParams(c, z.object({ category: category.default("places") }));
    return c.json(await mapSavesForCategory(db, c.get("userId"), cat));
  });

  // Candidate saves for a city (powers the "you've arrived" local notification).
  r.get("/saves/city", async (c) => {
    const q = queryParams(
      c,
      z.object({
        city: z.string().trim().min(1).max(120),
        categories: z
          .string()
          .default("places")
          .transform((s) => s.split(",").filter(Boolean))
          .pipe(z.array(category).min(1).max(7)),
      }),
    );
    return c.json({ saves: await savesInCity(db, c.get("userId"), q.city, q.categories) });
  });

  r.post("/saves/manual", async (c) => {
    const body = await jsonBody(c, manualSchema);
    const save = await createManualSave(db, c.get("userId"), {
      source_url: body.source_url ?? null,
      source_platform: body.source_platform,
      category: body.category,
      location: body.location,
    });
    return c.json({ save }, 201);
  });

  r.get("/saves/:id", async (c) => {
    const userId = c.get("userId");
    const { id } = pathParams(c, idParam);
    const found = await getVisibleSave(db, userId, id);
    if (!found) throw notFound("Save");
    const location = await getLocation(db, id);
    if (!found.owned)
      return c.json({ save: toPublicSave(found.save), location, board_ids: [], owned: false });
    return c.json({
      save: found.save,
      location,
      board_ids: await boardIdsForSave(db, userId, id),
      owned: true,
    });
  });

  r.get("/saves/:id/similar", async (c) => {
    const userId = c.get("userId");
    const { id } = pathParams(c, idParam);
    const found = await getVisibleSave(db, userId, id);
    if (!found?.owned) throw notFound("Save");
    return c.json({ saves: await similarSaves(db, userId, id, found.save.category) });
  });

  r.patch("/saves/:id", async (c) => {
    const userId = c.get("userId");
    const { id } = pathParams(c, idParam);
    const body = await jsonBody(c, patchSchema);
    if (body.sub_category_id && !(await ownsSubCategory(db, userId, body.sub_category_id))) {
      throw badRequest("Unknown sub-category");
    }
    const { viewed, ...rest } = body;
    const save = await updateSave(db, userId, id, {
      ...rest,
      ...(viewed ? { last_viewed_at: true } : {}),
    });
    if (!save) throw notFound("Save");
    return c.json({ save });
  });

  r.post("/saves/:id/archive", async (c) => {
    const { id } = pathParams(c, idParam);
    const archived = await archiveSave(db, c.get("userId"), id);
    if (!archived) throw notFound("Save");
    return c.json({ archived });
  });

  r.get("/archived", async (c) => c.json({ archived: await listArchived(db, c.get("userId")) }));

  r.post("/archived/:id/restore", async (c) => {
    const { id } = pathParams(c, idParam);
    if (!(await restoreArchived(db, c.get("userId"), id))) throw notFound("Archived save");
    return c.body(null, 204);
  });

  r.delete("/archived/:id", async (c) => {
    const { id } = pathParams(c, idParam);
    if (!(await deleteArchived(db, c.get("userId"), id))) throw notFound("Archived save");
    return c.body(null, 204);
  });

  r.get("/activity", async (c) => c.json(await activityFeed(db, c.get("userId"))));

  return r;
}
