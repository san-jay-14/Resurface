import { Hono } from "hono";
import { z } from "zod";
import {
  BoardNameTakenError,
  addSaveToBoard,
  boardMapSaves,
  categoryShareBoard,
  createBoard,
  deleteBoard,
  getBoardDetail,
  joinBoard,
  listBoards,
  leaveBoard,
  removeReaction,
  removeSaveFromBoard,
  setReaction,
  shareBoard,
} from "../../db/repos/boards.ts";
import { CATEGORIES } from "../../db/repos/saves.ts";
import { AppError, badRequest, conflict, forbidden, notFound } from "../../errors.ts";
import type { AppEnv, Services } from "../context.ts";
import { rateLimit } from "../middleware.ts";
import { jsonBody, pathParams } from "../validate.ts";

const idParam = z.object({ id: z.uuid() });
const boardSave = z.object({ id: z.uuid(), saveId: z.uuid() });

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).nullable().optional(),
    requires_location: z.boolean().optional(),
  })
  .strict();

export function boardRoutes(svc: Services): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const { db } = svc;

  r.get("/boards", async (c) => {
    return c.json({ boards: await listBoards(db, c.get("userId")) });
  });

  r.post("/boards", async (c) => {
    const body = await jsonBody(c, createSchema);
    try {
      const board = await createBoard(db, c.get("userId"), body);
      return c.json({ board }, 201);
    } catch (err) {
      if (err instanceof BoardNameTakenError) throw conflict(err.message, "board_name_taken");
      throw err;
    }
  });

  // Joining is the only way to enumerate invite codes, so it is rate limited per user.
  r.post(
    "/boards/join",
    rateLimit({ windowMs: 60_000, max: 10, key: (c) => `join:${c.get("userId")}` }),
    async (c) => {
      const { code } = await jsonBody(
        c,
        z.object({ code: z.string().trim().min(6).max(12) }).strict(),
      );
      const result = await joinBoard(db, c.get("userId"), code);
      if (result.status === "invalid_code") {
        throw new AppError(
          404,
          "invalid_invite_code",
          "That code doesn't look right. Check with whoever sent it.",
        );
      }
      return c.json(result);
    },
  );

  r.post("/boards/category-share", async (c) => {
    const { category, label } = await jsonBody(
      c,
      z
        .object({
          category: z.enum(CATEGORIES).exclude(["unsorted"]),
          label: z.string().trim().min(1).max(60),
        })
        .strict(),
    );
    return c.json({ board: await categoryShareBoard(db, c.get("userId"), category, label) });
  });

  r.get("/boards/:id", async (c) => {
    const { id } = pathParams(c, idParam);
    const detail = await getBoardDetail(db, c.get("userId"), id);
    if (!detail) throw notFound("Board");
    return c.json(detail);
  });

  r.delete("/boards/:id", async (c) => {
    const { id } = pathParams(c, idParam);
    if (!(await deleteBoard(db, c.get("userId"), id))) throw notFound("Board");
    return c.body(null, 204);
  });

  r.post("/boards/:id/saves", async (c) => {
    const { id } = pathParams(c, idParam);
    const { save_id } = await jsonBody(c, z.object({ save_id: z.uuid() }).strict());
    const result = await addSaveToBoard(db, c.get("userId"), id, save_id);
    if (result === "no_board") throw notFound("Board");
    if (result === "no_save") throw notFound("Save");
    return c.body(null, 204);
  });

  r.delete("/boards/:id/saves/:saveId", async (c) => {
    const { id, saveId } = pathParams(c, boardSave);
    if (!(await removeSaveFromBoard(db, c.get("userId"), id, saveId)))
      throw notFound("Board entry");
    return c.body(null, 204);
  });

  r.post("/boards/:id/share", async (c) => {
    const { id } = pathParams(c, idParam);
    const board = await shareBoard(db, c.get("userId"), id);
    if (!board) throw notFound("Board");
    return c.json({ board });
  });

  r.delete("/boards/:id/members/me", async (c) => {
    const { id } = pathParams(c, idParam);
    const result = await leaveBoard(db, c.get("userId"), id);
    if (result === "owner")
      throw badRequest("Owners cannot leave their own board; delete it instead");
    if (result === "not_member") throw notFound("Membership");
    return c.body(null, 204);
  });

  r.put("/boards/:id/reactions", async (c) => {
    const { id } = pathParams(c, idParam);
    const { save_id, reaction } = await jsonBody(
      c,
      z.object({ save_id: z.uuid(), reaction: z.enum(["in", "pass"]) }).strict(),
    );
    const result = await setReaction(db, c.get("userId"), id, save_id, reaction);
    if (result === "no_access") throw forbidden();
    if (result === "no_save") throw notFound("Save on this board");
    return c.body(null, 204);
  });

  r.delete("/boards/:id/reactions/:saveId", async (c) => {
    const { id, saveId } = pathParams(c, boardSave);
    await removeReaction(db, c.get("userId"), id, saveId);
    return c.body(null, 204);
  });

  r.get("/boards/:id/map", async (c) => {
    const { id } = pathParams(c, idParam);
    const result = await boardMapSaves(db, c.get("userId"), id);
    if (!result) throw notFound("Board");
    return c.json(result);
  });

  return r;
}
