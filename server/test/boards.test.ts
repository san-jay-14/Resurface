import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers/app.ts";
import { makeLocation, makeSave } from "./helpers/factories.ts";

describe("boards", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.db.close();
  });

  const createBoard = async (userId: string, name: string, extra: object = {}) =>
    (await t.call(userId, "POST", "/v1/boards", { name, ...extra })).json.board as {
      id: string;
      invite_code: string | null;
    };

  it("creates boards, rejects duplicate names case-insensitively, and lists them with counts", async () => {
    const a = await t.makeUser("b1");
    const b1 = await createBoard(a, "Goa Trip", { requires_location: true });
    const dup = await t.call(a, "POST", "/v1/boards", { name: "goa trip" });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("board_name_taken");
    const s = await makeSave(t.db, a, { thumbnail_url: "https://img.test/t.jpg" });
    const bare = await makeSave(t.db, a);
    await t.call(a, "POST", `/v1/boards/${b1.id}/saves`, { save_id: s });
    await t.call(a, "POST", `/v1/boards/${b1.id}/saves`, { save_id: bare });
    const list = await t.call(a, "GET", "/v1/boards");
    expect(list.json.boards[0].thumbnails).toEqual(["https://img.test/t.jpg"]);
    expect(list.json.boards).toHaveLength(1);
    expect(list.json.boards[0]).toMatchObject({
      name: "Goa Trip",
      save_count: 2,
      role: "owner",
      requires_location: true,
    });
  });

  it("only lets the owner add their own saves to their own board", async () => {
    const a = await t.makeUser("add-a");
    const b = await t.makeUser("add-b");
    const board = await createBoard(a, "Mine");
    const mine = await makeSave(t.db, a);
    const theirs = await makeSave(t.db, b);
    expect(
      (await t.call(a, "POST", `/v1/boards/${board.id}/saves`, { save_id: theirs })).status,
    ).toBe(404);
    expect(
      (await t.call(b, "POST", `/v1/boards/${board.id}/saves`, { save_id: theirs })).status,
    ).toBe(404);
    expect(
      (await t.call(a, "POST", `/v1/boards/${board.id}/saves`, { save_id: mine })).status,
    ).toBe(204);
    // idempotent
    expect(
      (await t.call(a, "POST", `/v1/boards/${board.id}/saves`, { save_id: mine })).status,
    ).toBe(204);
    expect((await t.call(b, "DELETE", `/v1/boards/${board.id}/saves/${mine}`)).status).toBe(404);
    expect((await t.call(a, "DELETE", `/v1/boards/${board.id}/saves/${mine}`)).status).toBe(204);
  });

  describe("sharing", () => {
    it("generates a stable invite code, makes the owner a member, and never regenerates it", async () => {
      const a = await t.makeUser("sh");
      const board = await createBoard(a, "Shared");
      const first = (await t.call(a, "POST", `/v1/boards/${board.id}/share`)).json.board;
      expect(first.is_shared).toBe(true);
      expect(first.invite_code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      const second = (await t.call(a, "POST", `/v1/boards/${board.id}/share`)).json.board;
      expect(second.invite_code).toBe(first.invite_code);
      const owner = await t.db.query(
        "select role from collection_members where collection_id = $1 and user_id = $2",
        [board.id, a],
      );
      expect(owner.rows[0]).toEqual({ role: "owner" });
    });

    it("only the owner can share", async () => {
      const a = await t.makeUser("sh-a");
      const b = await t.makeUser("sh-b");
      const board = await createBoard(a, "Nope");
      expect((await t.call(b, "POST", `/v1/boards/${board.id}/share`)).status).toBe(404);
    });

    it("joins by code with a correct save count, is idempotent, and rejects bad codes", async () => {
      const owner = await t.makeUser("jo");
      const friend = await t.makeUser("jf");
      const board = await createBoard(owner, "Weekend");
      const s1 = await makeSave(t.db, owner);
      const s2 = await makeSave(t.db, owner);
      for (const s of [s1, s2])
        await t.call(owner, "POST", `/v1/boards/${board.id}/saves`, { save_id: s });
      const code = (await t.call(owner, "POST", `/v1/boards/${board.id}/share`)).json.board
        .invite_code as string;

      const bad = await t.call(friend, "POST", "/v1/boards/join", { code: "ZZZZZZZZ" });
      expect(bad.status).toBe(404);
      expect(bad.json.error.code).toBe("invalid_invite_code");

      const joined = await t.call(friend, "POST", "/v1/boards/join", { code: code.toLowerCase() });
      expect(joined.status).toBe(200);
      expect(joined.json.status).toBe("joined");
      expect(joined.json.board).toMatchObject({ id: board.id, name: "Weekend", save_count: 2 });

      expect((await t.call(friend, "POST", "/v1/boards/join", { code })).json.status).toBe(
        "already_member",
      );
      expect((await t.call(owner, "POST", "/v1/boards/join", { code })).json.status).toBe(
        "already_member",
      );
    });

    it("an unshared board's code does not work", async () => {
      const owner = await t.makeUser("us");
      const friend = await t.makeUser("us2");
      const board = await createBoard(owner, "Private");
      await t.db.query("update collections set invite_code = 'PRIVATE2' where id = $1", [board.id]);
      expect((await t.call(friend, "POST", "/v1/boards/join", { code: "PRIVATE2" })).status).toBe(
        404,
      );
    });

    it("rate limits invite-code guessing", async () => {
      const friend = await t.makeUser("rl");
      let blocked = 0;
      for (let i = 0; i < 12; i++) {
        const r = await t.call(friend, "POST", "/v1/boards/join", { code: "AAAAAAAA" });
        if (r.status === 429) blocked += 1;
      }
      expect(blocked).toBeGreaterThanOrEqual(2);
    });
  });

  describe("shared board access", () => {
    async function sharedBoard() {
      const owner = await t.makeUser("sb-o");
      const member = await t.makeUser("sb-m");
      const stranger = await t.makeUser("sb-s");
      const board = await createBoard(owner, "Crew");
      const save = await makeSave(t.db, owner, {
        title: "Toit",
        note: "PRIVATE NOTE",
        acted_on: true,
        remind_at: new Date(Date.now() + 86_400_000),
      });
      await makeLocation(t.db, save, { place_name: "Toit" });
      await t.call(owner, "POST", `/v1/boards/${board.id}/saves`, { save_id: save });
      const code = (await t.call(owner, "POST", `/v1/boards/${board.id}/share`)).json.board
        .invite_code as string;
      await t.call(member, "POST", "/v1/boards/join", { code });
      return { owner, member, stranger, board, save };
    }

    it("members see the board and others' saves WITHOUT personal fields; strangers see nothing", async () => {
      const { owner, member, stranger, board, save } = await sharedBoard();

      const asMember = await t.call(member, "GET", `/v1/boards/${board.id}`);
      expect(asMember.status).toBe(200);
      expect(asMember.json.board.role).toBe("member");
      expect(asMember.json.members.map((m: { user_id: string }) => m.user_id).sort()).toEqual(
        [owner, member].sort(),
      );
      const s = asMember.json.saves[0];
      expect(s).toMatchObject({ id: save, title: "Toit", location: { place_name: "Toit" } });
      expect(JSON.stringify(s)).not.toContain("PRIVATE NOTE");
      for (const field of ["note", "acted_on", "remind_at", "is_favorite", "enrichment_status"]) {
        expect(s).not.toHaveProperty(field);
      }

      const asOwner = await t.call(owner, "GET", `/v1/boards/${board.id}`);
      expect(asOwner.json.saves[0].note).toBe("PRIVATE NOTE");

      expect((await t.call(stranger, "GET", `/v1/boards/${board.id}`)).status).toBe(404);
      expect((await t.call(stranger, "GET", `/v1/boards/${board.id}/map`)).status).toBe(404);
    });

    it("a member can open a save on a shared board (public view) but not edit it", async () => {
      const { member, stranger, save } = await sharedBoard();
      const view = await t.call(member, "GET", `/v1/saves/${save}`);
      expect(view.status).toBe(200);
      expect(view.json.owned).toBe(false);
      expect(JSON.stringify(view.json)).not.toContain("PRIVATE NOTE");
      expect(
        (await t.call(member, "PATCH", `/v1/saves/${save}`, { is_favorite: true })).status,
      ).toBe(404);
      expect((await t.call(stranger, "GET", `/v1/saves/${save}`)).status).toBe(404);
    });

    it("members list the joined board and can only delete it if they own it", async () => {
      const { member, board } = await sharedBoard();
      const list = await t.call(member, "GET", "/v1/boards");
      expect(list.json.boards.map((b: { id: string }) => b.id)).toContain(board.id);
      expect((await t.call(member, "DELETE", `/v1/boards/${board.id}`)).status).toBe(404);
    });

    it("reactions: members only, only for saves on the board, upsert and remove", async () => {
      const { owner, member, stranger, board, save } = await sharedBoard();
      const react = (u: string, reaction: string) =>
        t.call(u, "PUT", `/v1/boards/${board.id}/reactions`, { save_id: save, reaction });

      expect((await react(stranger, "in")).status).toBe(403);
      expect((await react(member, "in")).status).toBe(204);
      expect((await react(member, "pass")).status).toBe(204); // flips
      expect((await react(owner, "in")).status).toBe(204);
      const detail = await t.call(owner, "GET", `/v1/boards/${board.id}`);
      expect(detail.json.reactions).toHaveLength(2);
      expect(
        detail.json.reactions.find((r: { user_id: string }) => r.user_id === member).reaction,
      ).toBe("pass");

      const offBoard = await makeSave(t.db, owner);
      expect(
        (
          await t.call(member, "PUT", `/v1/boards/${board.id}/reactions`, {
            save_id: offBoard,
            reaction: "in",
          })
        ).status,
      ).toBe(404);

      expect(
        (await t.call(member, "DELETE", `/v1/boards/${board.id}/reactions/${save}`)).status,
      ).toBe(204);
      const after = await t.call(owner, "GET", `/v1/boards/${board.id}`);
      expect(after.json.reactions).toHaveLength(1);
    });

    it("leaving removes membership and reactions; owners cannot leave", async () => {
      const { owner, member, board, save } = await sharedBoard();
      await t.call(member, "PUT", `/v1/boards/${board.id}/reactions`, {
        save_id: save,
        reaction: "in",
      });
      expect((await t.call(owner, "DELETE", `/v1/boards/${board.id}/members/me`)).status).toBe(400);
      expect((await t.call(member, "DELETE", `/v1/boards/${board.id}/members/me`)).status).toBe(
        204,
      );
      expect((await t.call(member, "GET", `/v1/boards/${board.id}`)).status).toBe(404);
      const left = await t.db.query(
        "select 1 from collection_save_reactions where collection_id = $1 and user_id = $2",
        [board.id, member],
      );
      expect(left.rowCount).toBe(0);
      expect((await t.call(member, "DELETE", `/v1/boards/${board.id}/members/me`)).status).toBe(
        404,
      );
    });

    it("map data includes the board's located saves and hides others' personal fields", async () => {
      const { member, board } = await sharedBoard();
      const r = await t.call(member, "GET", `/v1/boards/${board.id}/map`);
      expect(r.json.mapped).toHaveLength(1);
      expect(r.json.mapped[0]).toMatchObject({
        location_name: "Toit",
        note: null,
        acted_on: false,
      });
      expect(r.json.unmapped_count).toBe(0);
    });
  });

  describe("category share", () => {
    it("creates a shadow board of the category, syncs saves, and is idempotent", async () => {
      const a = await t.makeUser("cs");
      const s1 = await makeSave(t.db, a, { category: "recipes" });
      await makeSave(t.db, a, { category: "recipes", archived: true });
      await makeSave(t.db, a, { category: "places" });

      const first = await t.call(a, "POST", "/v1/boards/category-share", {
        category: "recipes",
        label: "Recipes",
      });
      expect(first.status).toBe(200);
      const board = first.json.board;
      expect(board).toMatchObject({ source_category: "recipes", is_shared: true, name: "Recipes" });

      const s2 = await makeSave(t.db, a, { category: "recipes" });
      const second = await t.call(a, "POST", "/v1/boards/category-share", {
        category: "recipes",
        label: "Recipes",
      });
      expect(second.json.board.id).toBe(board.id);
      expect(second.json.board.invite_code).toBe(board.invite_code);

      const detail = await t.call(a, "GET", `/v1/boards/${board.id}`);
      expect(detail.json.saves.map((s: { id: string }) => s.id).sort()).toEqual([s1, s2].sort());
    });

    it("rejects the unsorted pseudo-category", async () => {
      const a = await t.makeUser("cs2");
      expect(
        (await t.call(a, "POST", "/v1/boards/category-share", { category: "unsorted", label: "x" }))
          .status,
      ).toBe(400);
    });
  });

  it("deleting a board removes its filings but not the saves", async () => {
    const a = await t.makeUser("del");
    const board = await createBoard(a, "Temp");
    const s = await makeSave(t.db, a);
    await t.call(a, "POST", `/v1/boards/${board.id}/saves`, { save_id: s });
    expect((await t.call(a, "DELETE", `/v1/boards/${board.id}`)).status).toBe(204);
    expect((await t.db.query("select 1 from saves where id = $1", [s])).rowCount).toBe(1);
    expect(
      (await t.db.query("select 1 from collection_saves where collection_id = $1", [board.id]))
        .rowCount,
    ).toBe(0);
  });
});
