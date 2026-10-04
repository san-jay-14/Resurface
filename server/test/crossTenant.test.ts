import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers/app.ts";
import { makeLocation, makeSave } from "./helpers/factories.ts";

/**
 * Authorization was Postgres RLS; it now lives in the API. This suite attacks every
 * resource-addressed route as a DIFFERENT authenticated user and asserts two things:
 *   1. the response is a denial (403/404, never 2xx), and
 *   2. no data changed.
 * Add a row here whenever a route that takes a resource id is added.
 */
describe("cross-tenant isolation", () => {
  let t: TestApp;
  let victim: string;
  let attacker: string;
  let ids: {
    save: string;
    archived: string;
    archivedSave: string;
    board: string;
    sub: string;
    notification: string;
    attackerSave: string;
  };

  beforeAll(async () => {
    t = await createTestApp();
    victim = await t.makeUser("victim");
    attacker = await t.makeUser("attacker");

    const save = await makeSave(t.db, victim, {
      title: "secret",
      note: "secret note",
      category: "places",
    });
    await makeLocation(t.db, save);
    const archivedSave = await makeSave(t.db, victim, { title: "to-archive" });
    const archived = (await t.call(victim, "POST", `/v1/saves/${archivedSave}/archive`)).json
      .archived.id;
    const board = (await t.call(victim, "POST", "/v1/boards", { name: "Secret board" })).json.board
      .id;
    await t.call(victim, "POST", `/v1/boards/${board}/saves`, { save_id: save });
    await t.call(victim, "POST", `/v1/boards/${board}/share`);
    const sub = (
      await t.call(victim, "POST", "/v1/sub-categories", { category: "places", name: "S" })
    ).json.sub_category.id;
    const n = await t.db.query<{ id: string }>(
      "insert into notification_log (user_id, trigger_type) values ($1, 'birthday') returning id",
      [victim],
    );
    const attackerSave = await makeSave(t.db, attacker, { title: "mine" });
    ids = { save, archived, archivedSave, board, sub, notification: n.rows[0]!.id, attackerSave };
  });

  afterAll(async () => {
    await t.db.close();
  });

  /** A cheap fingerprint of everything the attacker could try to alter. */
  async function snapshot(): Promise<string> {
    const tables = [
      "saves",
      "archived_saves",
      "collections",
      "collection_saves",
      "collection_members",
      "collection_save_reactions",
      "user_sub_categories",
      "notification_log",
      "users",
    ];
    const parts: unknown[] = [];
    for (const table of tables) {
      parts.push((await t.db.query(`select * from ${table} order by 1`)).rows);
    }
    return JSON.stringify(parts);
  }

  const attacks: Array<{
    name: string;
    method: string;
    path: (i: typeof ids) => string;
    body?: (i: typeof ids) => unknown;
  }> = [
    { name: "read save", method: "GET", path: (i) => `/v1/saves/${i.save}` },
    { name: "similar saves", method: "GET", path: (i) => `/v1/saves/${i.save}/similar` },
    {
      name: "edit save",
      method: "PATCH",
      path: (i) => `/v1/saves/${i.save}`,
      body: () => ({ note: "pwned", is_favorite: true }),
    },
    { name: "archive save", method: "POST", path: (i) => `/v1/saves/${i.save}/archive` },
    { name: "restore archived", method: "POST", path: (i) => `/v1/archived/${i.archived}/restore` },
    { name: "delete archived", method: "DELETE", path: (i) => `/v1/archived/${i.archived}` },
    { name: "read board", method: "GET", path: (i) => `/v1/boards/${i.board}` },
    { name: "board map", method: "GET", path: (i) => `/v1/boards/${i.board}/map` },
    { name: "delete board", method: "DELETE", path: (i) => `/v1/boards/${i.board}` },
    { name: "share board", method: "POST", path: (i) => `/v1/boards/${i.board}/share` },
    {
      name: "add save to board",
      method: "POST",
      path: (i) => `/v1/boards/${i.board}/saves`,
      body: (i) => ({ save_id: i.save }),
    },
    {
      name: "remove save from board",
      method: "DELETE",
      path: (i) => `/v1/boards/${i.board}/saves/${i.save}`,
    },
    {
      name: "react on board",
      method: "PUT",
      path: (i) => `/v1/boards/${i.board}/reactions`,
      body: (i) => ({ save_id: i.save, reaction: "in" }),
    },
    {
      name: "leave someone else's board",
      method: "DELETE",
      path: (i) => `/v1/boards/${i.board}/members/me`,
    },
    { name: "delete sub-category", method: "DELETE", path: (i) => `/v1/sub-categories/${i.sub}` },
    {
      name: "assign foreign sub-category to own save",
      method: "PATCH",
      path: (i) => `/v1/saves/${i.attackerSave}`,
      body: (i) => ({ sub_category_id: i.sub }),
    },
    {
      name: "tap foreign notification",
      method: "POST",
      path: (i) => `/v1/notifications/${i.notification}/tapped`,
    },
  ];

  it.each(attacks)("denies and does not mutate: $name", async (attack) => {
    const before = await snapshot();
    const r = await t.call(attacker, attack.method, attack.path(ids), attack.body?.(ids));
    expect([400, 403, 404]).toContain(r.status);
    expect(JSON.stringify(r.json)).not.toContain("secret");
    expect(await snapshot()).toBe(before);
  });

  it("list endpoints never include the victim's data", async () => {
    for (const path of [
      "/v1/saves?archived=any",
      "/v1/archived",
      "/v1/boards",
      "/v1/activity",
      "/v1/saves/map",
      "/v1/saves/counts",
    ]) {
      const r = await t.call(attacker, "GET", path);
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.json)).not.toContain(victim);
      expect(JSON.stringify(r.json)).not.toContain("secret");
    }
  });

  it("every /v1 route requires authentication", async () => {
    const routes: Array<[string, string]> = [
      ["GET", "/v1/me"],
      ["GET", "/v1/saves"],
      ["POST", "/v1/saves/manual"],
      ["GET", `/v1/saves/${ids.save}`],
      ["GET", "/v1/boards"],
      ["POST", "/v1/boards/join"],
      ["GET", "/v1/archived"],
      ["GET", "/v1/activity"],
      ["PUT", "/v1/device-tokens"],
      ["POST", "/v1/share-token"],
    ];
    for (const [method, path] of routes) {
      const r = await t.call(null, method, path, method === "GET" ? undefined : {});
      expect(r.status, `${method} ${path}`).toBe(401);
    }
  });
});
