import { randomInt } from "node:crypto";
import type { Db, Queryable, Row } from "../client.ts";
import { one } from "../client.ts";
import { type Category, type PlaceSave, type SaveRow, toPublicSave } from "./saves.ts";

export interface Board extends Row {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  requires_location: boolean;
  source_category: Category | null;
  is_shared: boolean;
  invite_code: string | null;
  created_at: Date;
  updated_at: Date;
}

const BOARD_NAMES = [
  "id",
  "owner_id",
  "name",
  "description",
  "requires_location",
  "source_category",
  "is_shared",
  "invite_code",
  "created_at",
  "updated_at",
] as const;
const BOARD_COLS = BOARD_NAMES.map((c) => `c.${c}`).join(", ");
const BOARD_BARE = BOARD_NAMES.join(", ");

/** Unambiguous alphabet (no 0/O/1/I): codes are typed by hand. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const generateInviteCode = (length = 8): string =>
  Array.from({ length }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

export type Role = "owner" | "member";

/** The caller's role on a board, or null if they have no access. The owner always has access. */
export async function roleOn(q: Queryable, userId: string, boardId: string): Promise<Role | null> {
  const r = await one<{ role: Role }>(
    q,
    `select case when c.owner_id = $1 then 'owner' else m.role end as role
       from collections c
       left join collection_members m on m.collection_id = c.id and m.user_id = $1
      where c.id = $2 and (c.owner_id = $1 or m.user_id = $1)`,
    [userId, boardId],
  );
  return r?.role ?? null;
}

export interface BoardSummary extends Board {
  /** Cover images: the three most recently added saves that have a thumbnail. */
  thumbnails: string[];
  save_count: number;
  member_count: number;
  role: Role;
}

/** Boards the user owns or has joined. */
export async function listBoards(q: Queryable, userId: string): Promise<BoardSummary[]> {
  const r = await q.query<BoardSummary>(
    `select ${BOARD_COLS},
            array(select s.thumbnail_url
                    from collection_saves cs join saves s on s.id = cs.save_id
                   where cs.collection_id = c.id and s.thumbnail_url is not null
                   order by cs.added_at desc limit 3) as thumbnails,
            (select count(*)::int from collection_saves cs where cs.collection_id = c.id) as save_count,
            (select count(*)::int from collection_members m2 where m2.collection_id = c.id) as member_count,
            case when c.owner_id = $1 then 'owner' else m.role end as role
       from collections c
       left join collection_members m on m.collection_id = c.id and m.user_id = $1
      where c.owner_id = $1 or m.user_id = $1
      order by lower(c.name)`,
    [userId],
  );
  return r.rows;
}

export class BoardNameTakenError extends Error {
  constructor() {
    super("You already have a board with that name");
    this.name = "BoardNameTakenError";
  }
}

export interface NewBoard {
  name: string;
  description?: string | null;
  requires_location?: boolean;
}

export async function createBoard(q: Queryable, userId: string, input: NewBoard): Promise<Board> {
  try {
    const b = await one<Board>(
      q,
      `insert into collections (owner_id, name, description, requires_location)
       values ($1, $2, $3, $4) returning ${BOARD_BARE}`,
      [userId, input.name, input.description ?? null, input.requires_location ?? false],
    );
    if (!b) throw new Error("insert returned no row");
    return b;
  } catch (err) {
    if (isUniqueViolation(err)) throw new BoardNameTakenError();
    throw err;
  }
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e.code === "23505" || /duplicate key|unique constraint/i.test(e.message ?? "");
}

export async function deleteBoard(q: Queryable, userId: string, boardId: string): Promise<boolean> {
  const r = await q.query("delete from collections where id = $1 and owner_id = $2", [
    boardId,
    userId,
  ]);
  return r.rowCount > 0;
}

export interface BoardDetail {
  board: BoardSummary;
  /** Own saves in full; other members' saves reduced to the public subset. */
  saves: Array<Partial<SaveRow> & { location?: BoardLocation | null }>;
  members: {
    user_id: string;
    name: string | null;
    avatar_url: string | null;
    role: Role;
    joined_at: Date;
  }[];
  reactions: { save_id: string; user_id: string; reaction: "in" | "pass"; created_at: Date }[];
}

interface BoardLocation {
  place_name: string | null;
  lat: number | null;
  lng: number | null;
  city: string | null;
  google_place_id: string | null;
}

export async function getBoardDetail(
  q: Queryable,
  userId: string,
  boardId: string,
): Promise<BoardDetail | null> {
  const board = (await listBoards(q, userId)).find((b) => b.id === boardId);
  if (!board) return null;

  const rows = await q.query<SaveRow & BoardLocation>(
    `select s.*, l.place_name, l.lat, l.lng, l.city, l.google_place_id
       from collection_saves cs
       join saves s on s.id = cs.save_id
       left join save_locations l on l.save_id = s.id
      where cs.collection_id = $1
      order by cs.added_at desc`,
    [boardId],
  );
  const saves = rows.rows.map((row) => {
    const base: Partial<SaveRow> = row.user_id === userId ? stripLocation(row) : toPublicSave(row);
    const location: BoardLocation | null =
      row.lat != null && row.lng != null
        ? {
            place_name: row.place_name,
            lat: row.lat,
            lng: row.lng,
            city: row.city,
            google_place_id: row.google_place_id,
          }
        : null;
    return { ...base, location };
  });

  const members = await q.query<BoardDetail["members"][number]>(
    `select m.user_id, u.name, u.avatar_url, m.role, m.joined_at
       from collection_members m join users u on u.id = m.user_id
      where m.collection_id = $1 order by m.joined_at`,
    [boardId],
  );
  const reactions = await q.query<BoardDetail["reactions"][number]>(
    `select save_id, user_id, reaction, created_at from collection_save_reactions where collection_id = $1`,
    [boardId],
  );
  return { board, saves, members: members.rows, reactions: reactions.rows };
}

function stripLocation(row: SaveRow & BoardLocation): Partial<SaveRow> {
  const { place_name: _p, lat: _a, lng: _o, city: _c, google_place_id: _g, ...save } = row;
  return save;
}

/** Add one of the OWNER's saves to a board they own. */
export async function addSaveToBoard(
  q: Queryable,
  userId: string,
  boardId: string,
  saveId: string,
): Promise<"ok" | "no_board" | "no_save"> {
  const board = await one(q, "select 1 from collections where id = $1 and owner_id = $2", [
    boardId,
    userId,
  ]);
  if (!board) return "no_board";
  const save = await one(q, "select 1 from saves where id = $1 and user_id = $2", [saveId, userId]);
  if (!save) return "no_save";
  await q.query(
    `insert into collection_saves (collection_id, save_id) values ($1, $2) on conflict do nothing`,
    [boardId, saveId],
  );
  return "ok";
}

export async function removeSaveFromBoard(
  q: Queryable,
  userId: string,
  boardId: string,
  saveId: string,
): Promise<boolean> {
  const r = await q.query(
    `delete from collection_saves cs using collections c
      where cs.collection_id = c.id and c.id = $1 and c.owner_id = $2 and cs.save_id = $3`,
    [boardId, userId, saveId],
  );
  return r.rowCount > 0;
}

/** Boards (of the user's own) that already contain this save. */
export async function boardIdsForSave(
  q: Queryable,
  userId: string,
  saveId: string,
): Promise<string[]> {
  const r = await q.query<{ collection_id: string }>(
    `select cs.collection_id from collection_saves cs join collections c on c.id = cs.collection_id
      where cs.save_id = $1 and c.owner_id = $2`,
    [saveId, userId],
  );
  return r.rows.map((x) => x.collection_id);
}

/**
 * Make a board shareable. The invite code is generated server-side with retries on collision and
 * is never regenerated once set (re-sharing must not invalidate links already handed out).
 */
export async function shareBoard(db: Db, userId: string, boardId: string): Promise<Board | null> {
  return db.tx(async (q) => {
    const board = await one<Board>(
      q,
      `select ${BOARD_COLS} from collections c where c.id = $1 and c.owner_id = $2 for update`,
      [boardId, userId],
    );
    if (!board) return null;
    let code = board.invite_code;
    if (!code) {
      for (let attempt = 0; attempt < 8 && !code; attempt++) {
        const candidate = generateInviteCode();
        const taken = await one(q, "select 1 from collections where invite_code = $1", [candidate]);
        if (!taken) code = candidate;
      }
      if (!code) throw new Error("could not allocate an invite code");
    }
    await q.query(
      `insert into collection_members (collection_id, user_id, role) values ($1, $2, 'owner')
       on conflict (collection_id, user_id) do update set role = 'owner'`,
      [boardId, userId],
    );
    return one<Board>(
      q,
      `update collections c set is_shared = true, invite_code = $2 where c.id = $1
       returning ${BOARD_BARE}`,
      [boardId, code],
    );
  });
}

export type JoinResult =
  | {
      status: "joined" | "already_member";
      board: { id: string; name: string; owner_id: string; is_shared: boolean; save_count: number };
    }
  | { status: "invalid_code" };

export async function joinBoard(db: Db, userId: string, rawCode: string): Promise<JoinResult> {
  const code = rawCode.trim().toUpperCase();
  return db.tx(async (q) => {
    const board = await one<{ id: string; name: string; owner_id: string; is_shared: boolean }>(
      q,
      `select id, name, owner_id, is_shared from collections where invite_code = $1 and is_shared = true`,
      [code],
    );
    if (!board) return { status: "invalid_code" } as const;
    const count = await one<{ n: number }>(
      q,
      "select count(*)::int as n from collection_saves where collection_id = $1",
      [board.id],
    );
    const saveCount = count?.n ?? 0;
    const existing = await one(
      q,
      "select 1 from collection_members where collection_id = $1 and user_id = $2",
      [board.id, userId],
    );
    if (existing || board.owner_id === userId) {
      return { status: "already_member", board: { ...board, save_count: saveCount } } as const;
    }
    await q.query(
      `insert into collection_members (collection_id, user_id, role) values ($1, $2, 'member')
       on conflict do nothing`,
      [board.id, userId],
    );
    return { status: "joined", board: { ...board, save_count: saveCount } } as const;
  });
}

/** Members may leave; the owner must delete the board instead. */
export async function leaveBoard(
  q: Queryable,
  userId: string,
  boardId: string,
): Promise<"left" | "owner" | "not_member"> {
  const board = await one<{ owner_id: string }>(
    q,
    "select owner_id from collections where id = $1",
    [boardId],
  );
  if (board?.owner_id === userId) return "owner";
  const r = await q.query(
    "delete from collection_members where collection_id = $1 and user_id = $2",
    [boardId, userId],
  );
  // Their reactions go with them.
  await q.query("delete from collection_save_reactions where collection_id = $1 and user_id = $2", [
    boardId,
    userId,
  ]);
  return r.rowCount > 0 ? "left" : "not_member";
}

/** A member may react to saves that are actually on the board. */
export async function setReaction(
  q: Queryable,
  userId: string,
  boardId: string,
  saveId: string,
  reaction: "in" | "pass",
): Promise<"ok" | "no_access" | "no_save"> {
  if (!(await roleOn(q, userId, boardId))) return "no_access";
  const onBoard = await one(
    q,
    "select 1 from collection_saves where collection_id = $1 and save_id = $2",
    [boardId, saveId],
  );
  if (!onBoard) return "no_save";
  await q.query(
    `insert into collection_save_reactions (collection_id, save_id, user_id, reaction)
     values ($1, $2, $3, $4)
     on conflict (collection_id, save_id, user_id) do update set reaction = excluded.reaction`,
    [boardId, saveId, userId, reaction],
  );
  return "ok";
}

export async function removeReaction(
  q: Queryable,
  userId: string,
  boardId: string,
  saveId: string,
): Promise<void> {
  await q.query(
    "delete from collection_save_reactions where collection_id = $1 and save_id = $2 and user_id = $3",
    [boardId, saveId, userId],
  );
}

/**
 * The shareable "shadow" board that mirrors one of the user's categories: created on first use and
 * topped up with the category's saves each time, so sharing a category shares its current contents.
 */
export async function categoryShareBoard(
  db: Db,
  userId: string,
  category: Category,
  displayName: string,
): Promise<Board> {
  const board = await db.tx(async (q) => {
    let b = await one<Board>(
      q,
      `select ${BOARD_COLS} from collections c where c.owner_id = $1 and c.source_category = $2`,
      [userId, category],
    );
    if (!b) {
      b = await one<Board>(
        q,
        `insert into collections (owner_id, name, source_category) values ($1, $2, $3)
         on conflict do nothing returning ${BOARD_BARE}`,
        [userId, displayName, category],
      );
      b ??= await one<Board>(
        q,
        `select ${BOARD_COLS} from collections c where c.owner_id = $1 and c.source_category = $2`,
        [userId, category],
      );
    }
    if (!b) throw new Error("could not create category board");
    await q.query(
      `insert into collection_saves (collection_id, save_id)
       select $1, s.id from saves s where s.user_id = $2 and s.category = $3 and s.archived = false
       on conflict do nothing`,
      [b.id, userId, category],
    );
    return b;
  });
  const shared = await shareBoard(db, userId, board.id);
  if (!shared) throw new Error("category board vanished");
  return shared;
}

/** Locations of a board's saves, for boards that mark places on a map. */
export async function boardMapSaves(
  q: Queryable,
  userId: string,
  boardId: string,
): Promise<{ mapped: PlaceSave[]; unmapped_count: number } | null> {
  if (!(await roleOn(q, userId, boardId))) return null;
  const all = await one<{ n: number }>(
    q,
    "select count(*)::int as n from collection_saves where collection_id = $1",
    [boardId],
  );
  const mapped = await q.query<PlaceSave>(
    `select s.id, s.caption,
            case when s.user_id = $2 then s.note end as note,
            s.thumbnail_url,
            case when s.user_id = $2 then s.acted_on else false end as acted_on,
            s.created_at, s.source_url,
            coalesce(l.place_name, 'Unnamed place') as location_name, l.city as location_city,
            l.lat, l.lng, l.google_place_id
       from collection_saves cs
       join saves s on s.id = cs.save_id
       join save_locations l on l.save_id = s.id
      where cs.collection_id = $1 and l.lat is not null and l.lng is not null`,
    [boardId, userId],
  );
  return {
    mapped: mapped.rows,
    unmapped_count: Math.max(0, (all?.n ?? 0) - mapped.rows.length),
  };
}
