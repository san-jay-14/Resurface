import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers/app.ts";
import { makeLocation, makeSave } from "./helpers/factories.ts";

describe("saves", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.db.close();
  });

  describe("listing", () => {
    it("scopes to the caller, hides archived by default, and filters", async () => {
      const a = await t.makeUser("la");
      const b = await t.makeUser("lb");
      const p1 = await makeSave(t.db, a, { category: "places", title: "Café Alpha" });
      await makeSave(t.db, a, { category: "recipes", title: "Pasta" });
      await makeSave(t.db, a, { category: "places", title: "Hidden", archived: true });
      await makeSave(t.db, b, { category: "places", title: "Bob's" });

      const all = await t.call(a, "GET", "/v1/saves");
      expect(all.json.saves.map((s: { title: string }) => s.title).sort()).toEqual([
        "Café Alpha",
        "Pasta",
      ]);

      const places = await t.call(a, "GET", "/v1/saves?category=places");
      expect(places.json.saves.map((s: { id: string }) => s.id)).toEqual([p1]);

      const any = await t.call(a, "GET", "/v1/saves?archived=any");
      expect(any.json.saves).toHaveLength(3);
    });

    it("searches title/description/note/caption and treats % and _ literally", async () => {
      const a = await t.makeUser("sr");
      await makeSave(t.db, a, { title: "100% juice" });
      await makeSave(t.db, a, { title: "plain", note: "remember the sunset" });
      await makeSave(t.db, a, { title: "other" });
      const pct = await t.call(a, "GET", `/v1/saves?q=${encodeURIComponent("100%")}`);
      expect(pct.json.saves.map((s: { title: string }) => s.title)).toEqual(["100% juice"]);
      const wild = await t.call(a, "GET", `/v1/saves?q=${encodeURIComponent("%")}`);
      expect(wild.json.saves).toHaveLength(1);
      const note = await t.call(a, "GET", "/v1/saves?q=sunset");
      expect(note.json.saves).toHaveLength(1);
    });

    it("supports updated_since polling, before-cursor, ids, order and limit", async () => {
      const a = await t.makeUser("pg");
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) ids.push(await makeSave(t.db, a, { title: `s${i}` }));
      const asc = await t.call(a, "GET", "/v1/saves?order=asc&limit=2");
      expect(asc.json.saves).toHaveLength(2);

      const before = new Date(Date.now() + 60_000).toISOString();
      await new Promise((r) => setTimeout(r, 15));
      const since = new Date().toISOString();
      await new Promise((r) => setTimeout(r, 15));
      await t.call(a, "PATCH", `/v1/saves/${ids[3]}`, { note: "touched" });
      const changed = await t.call(
        a,
        "GET",
        `/v1/saves?updated_since=${encodeURIComponent(since)}`,
      );
      expect(changed.json.saves.map((s: { id: string }) => s.id)).toEqual([ids[3]]);

      const older = await t.call(
        a,
        "GET",
        `/v1/saves?before=${encodeURIComponent(before)}&limit=500`,
      );
      expect(older.json.saves).toHaveLength(5);

      const some = await t.call(a, "GET", `/v1/saves?ids=${ids[0]},${ids[1]}`);
      expect(some.json.saves).toHaveLength(2);
    });

    it("rejects invalid query parameters", async () => {
      const a = await t.makeUser("iq");
      expect((await t.call(a, "GET", "/v1/saves?category=bogus")).status).toBe(400);
      expect((await t.call(a, "GET", "/v1/saves?limit=100000")).status).toBe(400);
      expect((await t.call(a, "GET", "/v1/saves?ids=not-a-uuid")).status).toBe(400);
    });

    it("counts live saves per category", async () => {
      const a = await t.makeUser("ct");
      await makeSave(t.db, a, { category: "places" });
      await makeSave(t.db, a, { category: "places" });
      await makeSave(t.db, a, { category: "recipes" });
      await makeSave(t.db, a, { category: "recipes", archived: true });
      const r = await t.call(a, "GET", "/v1/saves/counts");
      expect(r.json.counts).toEqual({ places: 2, recipes: 1 });
    });
  });

  describe("create / read / update", () => {
    it("creates a manual save with a location and validates input", async () => {
      const a = await t.makeUser("mn");
      const r = await t.call(a, "POST", "/v1/saves/manual", {
        category: "places",
        source_platform: "instagram",
        source_url: "https://www.instagram.com/reel/abc/",
        location: { place_name: "Toit", city: "Bengaluru" },
      });
      expect(r.status).toBe(201);
      expect(r.json.save).toMatchObject({ status: "manual", user_id: a, category: "places" });
      const loc = await t.call(a, "GET", `/v1/saves/${r.json.save.id}`);
      expect(loc.json.location).toMatchObject({ place_name: "Toit", city: "Bengaluru" });

      for (const bad of [
        { category: "places", source_platform: "myspace" },
        { category: "places", source_platform: "web", source_url: "javascript:alert(1)" },
        { category: "places", source_platform: "web", user_id: "x" },
      ]) {
        expect((await t.call(a, "POST", "/v1/saves/manual", bad)).status).toBe(400);
      }
    });

    it("patches owned saves, stamps acted_on_at, and rejects server-owned fields", async () => {
      const a = await t.makeUser("pt");
      const id = await makeSave(t.db, a);
      const r = await t.call(a, "PATCH", `/v1/saves/${id}`, {
        acted_on: true,
        is_favorite: true,
        note: "go!",
      });
      expect(r.status).toBe(200);
      expect(r.json.save).toMatchObject({ acted_on: true, is_favorite: true, note: "go!" });
      expect(r.json.save.acted_on_at).toBeTruthy();
      expect(r.json.save.last_interacted_at).toBeTruthy();

      const undone = await t.call(a, "PATCH", `/v1/saves/${id}`, { acted_on: false });
      expect(undone.json.save.acted_on_at).toBeNull();

      for (const bad of [
        { user_id: a },
        { status: "enriched" },
        { enrichment_status: "done" },
        { thumbnail_url: "x" },
      ]) {
        expect((await t.call(a, "PATCH", `/v1/saves/${id}`, bad)).status).toBe(400);
      }
    });

    it("viewing records last_viewed_at without counting as an interaction", async () => {
      const a = await t.makeUser("vw");
      const id = await makeSave(t.db, a);
      const r = await t.call(a, "PATCH", `/v1/saves/${id}`, { viewed: true });
      expect(r.json.save.last_viewed_at).toBeTruthy();
      expect(r.json.save.last_interacted_at).toBeNull();
    });

    it("only lets a save be assigned a sub-category the user owns", async () => {
      const a = await t.makeUser("sc-a");
      const b = await t.makeUser("sc-b");
      const sub = (
        await t.call(b, "POST", "/v1/sub-categories", { category: "places", name: "Goa" })
      ).json.sub_category.id;
      const id = await makeSave(t.db, a);
      expect((await t.call(a, "PATCH", `/v1/saves/${id}`, { sub_category_id: sub })).status).toBe(
        400,
      );
      const mine = (
        await t.call(a, "POST", "/v1/sub-categories", { category: "places", name: "Mine" })
      ).json.sub_category.id;
      expect((await t.call(a, "PATCH", `/v1/saves/${id}`, { sub_category_id: mine })).status).toBe(
        200,
      );
    });

    it("returns 404 for another user's save (no existence leak)", async () => {
      const a = await t.makeUser("o1");
      const b = await t.makeUser("o2");
      const id = await makeSave(t.db, a);
      expect((await t.call(b, "GET", `/v1/saves/${id}`)).status).toBe(404);
      expect((await t.call(b, "PATCH", `/v1/saves/${id}`, { note: "x" })).status).toBe(404);
      expect((await t.call(b, "GET", `/v1/saves/${id}/similar`)).status).toBe(404);
    });

    it("finds similar saves in the same category only", async () => {
      const a = await t.makeUser("sm");
      const id = await makeSave(t.db, a, { category: "recipes" });
      const sib = await makeSave(t.db, a, { category: "recipes" });
      await makeSave(t.db, a, { category: "places" });
      const r = await t.call(a, "GET", `/v1/saves/${id}/similar`);
      expect(r.json.saves.map((s: { id: string }) => s.id)).toEqual([sib]);
    });
  });

  describe("archive", () => {
    it("archives atomically, restores, and permanently deletes", async () => {
      const a = await t.makeUser("ar");
      const id = await makeSave(t.db, a, { title: "keep me" });

      const arch = await t.call(a, "POST", `/v1/saves/${id}/archive`);
      expect(arch.status).toBe(200);
      const archivedId = arch.json.archived.id as string;
      expect(arch.json.archived.original_data.title).toBe("keep me");
      expect((await t.call(a, "GET", "/v1/saves")).json.saves).toHaveLength(0);
      expect((await t.call(a, "GET", "/v1/archived")).json.archived).toHaveLength(1);
      // already archived -> nothing to archive again
      expect((await t.call(a, "POST", `/v1/saves/${id}/archive`)).status).toBe(404);

      expect((await t.call(a, "POST", `/v1/archived/${archivedId}/restore`)).status).toBe(204);
      expect((await t.call(a, "GET", "/v1/saves")).json.saves).toHaveLength(1);
      expect((await t.call(a, "GET", "/v1/archived")).json.archived).toHaveLength(0);

      const again = (await t.call(a, "POST", `/v1/saves/${id}/archive`)).json.archived.id as string;
      expect((await t.call(a, "DELETE", `/v1/archived/${again}`)).status).toBe(204);
      expect((await t.db.query("select 1 from saves where id = $1", [id])).rowCount).toBe(0);
    });
  });

  describe("map, city and activity", () => {
    it("returns mapped saves and the unmapped count, scoped to the caller", async () => {
      const a = await t.makeUser("mp");
      const b = await t.makeUser("mp2");
      const s1 = await makeSave(t.db, a, { category: "places", title: "x" });
      await makeLocation(t.db, s1, { place_name: "Toit", city: "Bengaluru" });
      await makeSave(t.db, a, { category: "places" }); // no location
      const s3 = await makeSave(t.db, a, { category: "places" });
      await makeLocation(t.db, s3, { lat: null, lng: null }); // location without coordinates
      const other = await makeSave(t.db, b, { category: "places" });
      await makeLocation(t.db, other);

      const r = await t.call(a, "GET", "/v1/saves/map?category=places");
      expect(r.json.mapped).toHaveLength(1);
      expect(r.json.mapped[0]).toMatchObject({
        id: s1,
        location_name: "Toit",
        location_city: "Bengaluru",
      });
      expect(r.json.unmapped_count).toBe(2);
    });

    it("city lookup is scoped to the caller and matches literally", async () => {
      const a = await t.makeUser("cy");
      const b = await t.makeUser("cy2");
      const mine = await makeSave(t.db, a, { category: "places", title: "mine" });
      await makeLocation(t.db, mine, { city: "Goa" });
      const theirs = await makeSave(t.db, b, { category: "places" });
      await makeLocation(t.db, theirs, { city: "Goa" });
      const r = await t.call(a, "GET", "/v1/saves/city?city=goa");
      expect(r.json.saves.map((s: { id: string }) => s.id)).toEqual([mine]);
      expect(
        (await t.call(a, "GET", `/v1/saves/city?city=${encodeURIComponent("%")}`)).json.saves,
      ).toHaveLength(0);
    });

    it("builds the activity feed with board filings", async () => {
      const a = await t.makeUser("ac");
      const id = await makeSave(t.db, a);
      const board = (await t.call(a, "POST", "/v1/boards", { name: "Trip" })).json.board.id;
      await t.call(a, "POST", `/v1/boards/${board}/saves`, { save_id: id });
      const r = await t.call(a, "GET", "/v1/activity");
      expect(r.json.saves).toHaveLength(1);
      expect(r.json.board_adds).toMatchObject([{ save_id: id, board_name: "Trip" }]);
    });
  });
});
