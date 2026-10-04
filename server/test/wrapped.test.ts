import { afterEach, describe, expect, it } from "vitest";
import {
  type WrappedSaveRow,
  computeStats,
  hourIn,
  isValidTimeZone,
  parseWrappedCopy,
  statsText,
} from "../src/domain/wrapped.ts";
import { type PipelineTest, createPipelineTest } from "./helpers/world.ts";

const row = (over: Partial<WrappedSaveRow> = {}): WrappedSaveRow => ({
  category: "places",
  source_platform: "instagram",
  acted_on: false,
  created_at: new Date("2026-10-01T12:00:00Z"),
  title: null,
  ai_description: null,
  ...over,
});

describe("wrapped stats", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  it("computes the peak hour in the USER's timezone, not the server's", () => {
    const saves = [
      row({ created_at: new Date("2026-10-01T17:00:00Z") }),
      row({ created_at: new Date("2026-10-02T17:30:00Z") }),
    ];
    expect(computeStats(saves, now, "UTC").peak_hour).toBe(17);
    expect(computeStats(saves, now, "Asia/Kolkata").peak_hour).toBe(22); // 17:00Z = 22:30 IST
    expect(computeStats(saves, now, "Not/AZone").peak_hour).toBe(17); // unknown zone falls back to UTC
    expect(hourIn(new Date("2026-10-01T00:00:00Z"), "America/Los_Angeles")).toBe(17);
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });

  it("finds the top category, platform mix, acted-on share and the oldest ignored save", () => {
    const saves = [
      row({
        category: "places",
        created_at: new Date("2026-09-01T00:00:00Z"),
        ai_description: "Old café",
        acted_on: false,
      }),
      row({ category: "places", acted_on: true }),
      row({
        category: "recipes",
        source_platform: "youtube",
        acted_on: false,
        created_at: new Date("2026-09-20T00:00:00Z"),
      }),
    ];
    const s = computeStats(saves, now);
    expect(s).toMatchObject({
      total: 3,
      acted_on: 1,
      top_category: "places",
      top_category_count: 2,
      oldest_dormant_caption: "Old café",
      oldest_dormant_days: 44,
    });
    expect(s.platforms).toEqual([
      { platform: "instagram", count: 2 },
      { platform: "youtube", count: 1 },
    ]);
    expect(statsText(s)).toContain("Acted on: 1 (33%)");
  });

  it("is deterministic on ties and safe on empty input", () => {
    const tie = computeStats([row({ category: "recipes" }), row({ category: "places" })], now);
    expect(tie.top_category).toBe("places"); // alphabetical tie-break
    expect(computeStats([], now)).toMatchObject({
      total: 0,
      top_category: "unsorted",
      peak_hour: 20,
      oldest_dormant_days: 0,
    });
  });

  it("validates model copy strictly", () => {
    const ok = {
      headline: "47 saves",
      label: "Chronic Saver",
      roast: "Never opened one",
      closing: "Cheers",
    };
    expect(parseWrappedCopy(JSON.stringify(ok))).toEqual(ok);
    expect(parseWrappedCopy("```json\n" + JSON.stringify(ok) + "\n```")).toEqual(ok);
    expect(parseWrappedCopy(JSON.stringify({ ...ok, closing: undefined }))).toBeNull();
    expect(parseWrappedCopy(JSON.stringify({ ...ok, roast: "x".repeat(500) }))).toBeNull();
    expect(parseWrappedCopy("sorry, no")).toBeNull();
  });
});

describe("wrapped API", () => {
  const open: PipelineTest[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((p) => p.t.db.close()));
  });
  const COPY = {
    headline: "20 saves, 0 plans",
    label: "Aspirational Homebody",
    roast: "Places never visited",
    closing: "Here's to someday",
  };
  const setup = async () => {
    const p = await createPipelineTest();
    open.push(p);
    p.w.copyText = JSON.stringify(COPY);
    return p;
  };
  const seed = (p: PipelineTest, userId: string, n: number) =>
    p.t.db.query(
      `insert into saves (user_id, source_platform, category, title, created_at)
       select $1, 'instagram', 'places', 'save ' || g, now() - make_interval(days => g % 30) from generate_series(1, $2::int) g`,
      [userId, n],
    );

  it("needs at least 15 saves in the window", async () => {
    const p = await setup();
    const u = await p.t.makeUser("w1");
    await seed(p, u, 14);
    const r = await p.t.call(u, "POST", "/v1/wrapped", {});
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("not_enough_saves");
    expect(p.w.calls.anthropic).toHaveLength(0); // no model spend below the threshold
  });

  it("generates, stores and returns a card with stats in the user's timezone", async () => {
    const p = await setup();
    const u = await p.t.makeUser("w2");
    await seed(p, u, 20);
    const r = await p.t.call(u, "POST", "/v1/wrapped", { tz: "Asia/Kolkata" });
    expect(r.status).toBe(201);
    expect(r.json.wrapped.copy).toEqual(COPY);
    expect(r.json.wrapped.stats_snapshot).toMatchObject({ total: 20, top_category: "places" });
    expect(r.json.reused).toBe(false);
    const prompt = JSON.stringify(p.w.calls.anthropic[0]!.request);
    expect(prompt).toContain("Total saves: 20");
    expect((await p.t.call(u, "GET", "/v1/wrapped")).json.wrapped).toHaveLength(1);
    expect((await p.t.call(u, "GET", `/v1/wrapped/${r.json.wrapped.id}`)).json.wrapped.id).toBe(
      r.json.wrapped.id,
    );
  });

  it("a double tap reuses the card instead of paying for a second generation", async () => {
    const p = await setup();
    const u = await p.t.makeUser("w3");
    await seed(p, u, 20);
    const a = await p.t.call(u, "POST", "/v1/wrapped", {});
    const b = await p.t.call(u, "POST", "/v1/wrapped", {});
    expect(b.status).toBe(200);
    expect(b.json).toMatchObject({ reused: true });
    expect(b.json.wrapped.id).toBe(a.json.wrapped.id);
    expect(p.w.calls.anthropic).toHaveLength(1);
  });

  it("caps generations at 3 per day", async () => {
    const p = await setup();
    const u = await p.t.makeUser("w4");
    await seed(p, u, 20);
    const periods = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"];
    const statuses: number[] = [];
    for (const period_start of periods) {
      statuses.push((await p.t.call(u, "POST", "/v1/wrapped", { period_start })).status);
    }
    expect(statuses).toEqual([201, 201, 201, 429]);
  });

  it("maps model trouble to clear errors and stores nothing", async () => {
    const p = await setup();
    const u = await p.t.makeUser("w5");
    await seed(p, u, 20);
    p.w.copyText = "not json at all";
    expect((await p.t.call(u, "POST", "/v1/wrapped", {})).status).toBe(502);
    p.w.copyText = null;
    expect((await p.t.call(u, "POST", "/v1/wrapped", {})).status).toBe(503);
    expect((await p.t.db.query("select 1 from wrapped_history")).rowCount).toBe(0);
  });

  it("validates input and isolates cards between users", async () => {
    const p = await setup();
    const a = await p.t.makeUser("wa");
    const b = await p.t.makeUser("wb");
    await seed(p, a, 20);
    expect((await p.t.call(a, "POST", "/v1/wrapped", { period_start: "yesterday" })).status).toBe(
      400,
    );
    expect((await p.t.call(a, "POST", "/v1/wrapped", { nope: 1 })).status).toBe(400);
    const id = (await p.t.call(a, "POST", "/v1/wrapped", {})).json.wrapped.id as string;
    expect((await p.t.call(b, "GET", `/v1/wrapped/${id}`)).status).toBe(404);
    expect((await p.t.call(b, "GET", "/v1/wrapped")).json.wrapped).toHaveLength(0);
  });
});
