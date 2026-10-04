import { afterEach, describe, expect, it } from "vitest";
import { drainOnce } from "../src/pipeline/drain.ts";
import { type PipelineTest, createPipelineTest, igMedia, makeDue } from "./helpers/world.ts";

describe("POST /v1/saves/enqueue", () => {
  const open: PipelineTest[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((p) => p.t.db.close()));
  });
  const setup = async (env: Record<string, string> = {}) => {
    const p = await createPipelineTest(env);
    open.push(p);
    return p;
  };
  const IG_URL = "https://www.instagram.com/reel/Enq0000001/?igsh=abc";

  it("creates exactly one save and one fetch job, kicks the drain, and is idempotent", async () => {
    const { t } = await setup();
    const u = await t.makeUser("enq");
    const first = await t.call(u, "POST", "/v1/saves/enqueue", { url: IG_URL });
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({
      created: true,
      platform: "instagram",
      content_id: "Enq0000001",
    });
    expect(t.kicks.count).toBe(1);

    const again = await t.call(u, "POST", "/v1/saves/enqueue", {
      url: "https://instagram.com/p/Enq0000001/",
    });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ created: false, save_id: first.json.save_id });
    expect(t.kicks.count).toBe(1); // no kick for a duplicate

    expect((await t.db.query("select 1 from saves where user_id = $1", [u])).rowCount).toBe(1);
    expect((await t.db.query("select 1 from enrichment_jobs")).rowCount).toBe(1);
    const save = (
      await t.db.query(
        "select enrichment_status, status, source_platform from saves where id = $1",
        [first.json.save_id],
      )
    ).rows[0];
    expect(save).toMatchObject({
      enrichment_status: "queued",
      status: "pending",
      source_platform: "instagram",
    });
  });

  it("different users saving the same post get separate saves sharing one analysis", async () => {
    const { t, w } = await setup();
    w.ig.set("Enq0000001", igMedia("Enq0000001", "Blue Tokai cafe"));
    const a = await t.makeUser("ea");
    const b = await t.makeUser("eb");
    const ra = await t.call(a, "POST", "/v1/saves/enqueue", { url: IG_URL });
    const rb = await t.call(b, "POST", "/v1/saves/enqueue", { url: IG_URL });
    expect(ra.json.save_id).not.toBe(rb.json.save_id);
    await drainOnce(t.svc);
    await makeDue(t); // the single-flight loser was requeued 5s out
    await drainOnce(t.svc);
    expect(w.calls.hiker).toBe(1);
    for (const id of [ra.json.save_id, rb.json.save_id]) {
      const s = (
        await t.db.query<{ enrichment_status: string }>(
          "select enrichment_status from saves where id = $1",
          [id],
        )
      ).rows[0];
      expect(s?.enrichment_status).toBe("done");
    }
  });

  it.each([
    ["no link in the text", "just some words", "no_url"],
    ["a profile page, not a post", "https://www.instagram.com/someuser/", "unresolvable"],
    ["a private-network URL", "http://169.254.169.254/latest/meta-data", "blocked"],
    ["localhost", "http://localhost:3000/admin", "blocked"],
    ["an unsupported scheme", "ftp://files.example/x", "no_url"],
  ])("rejects %s with a 422", async (_label, url, reason) => {
    const { t } = await setup();
    const u = await t.makeUser("bad");
    const r = await t.call(u, "POST", "/v1/saves/enqueue", { url });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe(reason);
    expect((await t.db.query("select 1 from saves")).rowCount).toBe(0);
    expect((await t.db.query("select 1 from enrichment_jobs")).rowCount).toBe(0);
  });

  it("accepts share text with surrounding words", async () => {
    const { t } = await setup();
    const u = await t.makeUser("txt");
    const r = await t.call(u, "POST", "/v1/saves/enqueue", {
      url: "Look at this 🔥 https://youtu.be/dQw4w9WgXcQ?si=1 wow",
    });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ platform: "youtube", content_id: "dQw4w9WgXcQ" });
  });

  it("validates the body and requires authentication", async () => {
    const { t } = await setup();
    const u = await t.makeUser("val");
    expect((await t.call(u, "POST", "/v1/saves/enqueue", {})).status).toBe(400);
    expect((await t.call(u, "POST", "/v1/saves/enqueue", { url: IG_URL, extra: 1 })).status).toBe(
      400,
    );
    expect((await t.call(null, "POST", "/v1/saves/enqueue", { url: IG_URL })).status).toBe(401);
  });

  it("is rate limited per user", async () => {
    const { t } = await setup({ USER_ENQUEUE_PER_MINUTE: "3" });
    const u = await t.makeUser("rl");
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push(
        (
          await t.call(u, "POST", "/v1/saves/enqueue", {
            url: `https://www.instagram.com/reel/Rate00000${i}/`,
          })
        ).status,
      );
    }
    expect(statuses.filter((s) => s === 429).length).toBe(2);
    // another user is unaffected
    const other = await t.makeUser("rl2");
    expect((await t.call(other, "POST", "/v1/saves/enqueue", { url: IG_URL })).status).toBe(201);
  });

  describe("share token (the Android worker's credential)", () => {
    it("works for enqueue and for nothing else", async () => {
      const { t } = await setup();
      const u = await t.makeUser("st");
      const token = (await t.call(u, "POST", "/v1/share-token", {})).json.token as string;
      const auth = { authorization: `ShareToken ${token}` };

      const ok = await t.call(null, "POST", "/v1/saves/enqueue", { url: IG_URL }, auth);
      expect(ok.status).toBe(201);
      const owner = (
        await t.db.query<{ user_id: string }>("select user_id from saves where id = $1", [
          ok.json.save_id,
        ])
      ).rows[0];
      expect(owner?.user_id).toBe(u);

      for (const [method, path] of [
        ["GET", "/v1/me"],
        ["GET", "/v1/saves"],
        ["GET", "/v1/boards"],
        ["POST", "/v1/share-token"],
        ["DELETE", "/v1/me"],
      ] as const) {
        const r = await t.call(null, method, path, method === "GET" ? undefined : {}, auth);
        expect(r.status, `${method} ${path}`).toBe(401);
      }
    });

    it("stops working once revoked (sign-out) and rejects garbage", async () => {
      const { t } = await setup();
      const u = await t.makeUser("rv");
      const token = (await t.call(u, "POST", "/v1/share-token", {})).json.token as string;
      await t.call(u, "DELETE", "/v1/share-token");
      const revoked = await t.call(
        null,
        "POST",
        "/v1/saves/enqueue",
        { url: IG_URL },
        { authorization: `ShareToken ${token}` },
      );
      expect(revoked.status).toBe(401);
      const junk = await t.call(
        null,
        "POST",
        "/v1/saves/enqueue",
        { url: IG_URL },
        { authorization: "ShareToken dst_nope" },
      );
      expect(junk.status).toBe(401);
    });
  });
});
