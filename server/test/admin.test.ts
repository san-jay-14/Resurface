import { afterEach, describe, expect, it } from "vitest";
import { drainOnce } from "../src/pipeline/drain.ts";
import {
  IG,
  type PipelineTest,
  createPipelineTest,
  igMedia,
  makeDue,
  newUser,
  share,
} from "./helpers/world.ts";

const TOKEN = "a".repeat(32);
const open: PipelineTest[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((p) => p.t.db.close()));
});
const setup = async (env: Record<string, string> = {}) => {
  const p = await createPipelineTest({ ADMIN_DASHBOARD_TOKEN: TOKEN, ...env });
  open.push(p);
  return p;
};
const admin = (p: PipelineTest, body: unknown, token: string | null = TOKEN) =>
  p.t.call(null, "POST", "/admin/api", body, token ? { "x-admin-token": token } : {});

describe("admin access control", () => {
  it("is disabled without a configured token", async () => {
    const p = await createPipelineTest();
    open.push(p);
    expect((await admin(p, { action: "overview" })).status).toBe(503);
  });

  it("rejects missing, wrong and near-miss tokens", async () => {
    const p = await setup();
    expect((await admin(p, { action: "overview" }, null)).status).toBe(401);
    expect((await admin(p, { action: "overview" }, "nope")).status).toBe(401);
    expect((await admin(p, { action: "overview" }, TOKEN.slice(0, -1))).status).toBe(401);
    expect((await admin(p, { action: "overview" }, `${TOKEN}x`)).status).toBe(401);
    // a user session is not an admin credential
    const u = await p.t.makeUser("notadmin");
    expect((await p.t.call(u, "POST", "/admin/api", { action: "overview" })).status).toBe(401);
  });

  it("rejects unknown actions and malformed parameters", async () => {
    const p = await setup();
    expect((await admin(p, { action: "drop_database" })).status).toBe(400);
    expect((await admin(p, { action: "run_events", run_id: "not-a-uuid" })).status).toBe(400);
    expect((await admin(p, { action: "jobs", limit: 100000 })).status).toBe(400);
  });

  it("serves the dashboard page with a locked-down CSP", async () => {
    const p = await setup();
    const res = await p.t.app.request("/admin");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
    const html = await res.text();
    expect(html).toContain("dibs. pipeline");
    expect(html).not.toMatch(/supabase/i);
  });
});

describe("admin read models", () => {
  it("reports an overview with jobs, providers, caches and tasks after real traffic", async () => {
    const p = await setup();
    p.w.ig.set("AdminReel01", igMedia("AdminReel01", "Blue Tokai cafe"));
    await share(p.t, await newUser(p.t), IG("AdminReel01"));
    await drainOnce(p.t.svc);
    await p.t.call(null, "POST", "/internal/tick?wait=true", undefined, {}); // 503: no tick secret, harmless

    const o = (await admin(p, { action: "overview" })).json;
    expect(o.jobs).toMatchObject({ queued: 0, running: 0, done: 1, dead: 0 });
    expect(o.saves.done).toBe(1);
    expect(o.events24h.ok).toBeGreaterThan(5);
    expect(o.providers.map((x: { provider: string }) => x.provider)).toEqual(
      expect.arrayContaining(["hikerapi", "anthropic"]),
    );
    expect(o.flags.map((f: { key: string }) => f.key)).toEqual([
      "frames_instagram_enabled",
      "frames_youtube_enabled",
    ]);
    expect(o.metrics.rungs).toEqual([{ resolved_by: "caption", saves: 1 }]);
    expect(o.config.model).toBe("claude-haiku-4-5-20251001");
  });

  it("lists runs and their step-by-step events", async () => {
    const p = await setup();
    p.w.ig.set("AdminReel02", igMedia("AdminReel02", "Blue Tokai cafe"));
    const s = await share(p.t, await newUser(p.t), IG("AdminReel02"));
    await drainOnce(p.t.svc);

    const runs = (await admin(p, { action: "runs", platform: "instagram" })).json.runs as Array<{
      run_id: string;
      job_id: number;
      errors: number;
    }>;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ job_id: s.jobId, errors: 0 });
    const byJob = (await admin(p, { action: "runs", job_id: s.jobId })).json.runs;
    expect(byJob).toHaveLength(1);

    const events = (await admin(p, { action: "run_events", run_id: runs[0]!.run_id })).json
      .events as Array<{ step: string; status: string }>;
    expect(events.map((e) => e.step)).toEqual(
      expect.arrayContaining(["fetch", "normalize", "ladder:metadata", "writeback", "job"]),
    );
    expect(events.every((e) => e.status !== "error")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("Blue Tokai cafe"); // captions never logged
  });

  it("filters runs to errors only", async () => {
    const p = await setup();
    p.w.ig.set("AdminOk0001", igMedia("AdminOk0001", "Blue Tokai cafe"));
    p.w.ig.set("AdminBad001", { status: 200, body: { media_or_ad: { weird: true } } });
    await share(p.t, await newUser(p.t), IG("AdminOk0001"));
    await share(p.t, await newUser(p.t), IG("AdminBad001"));
    await drainOnce(p.t.svc);
    const all = (await admin(p, { action: "runs" })).json.runs as unknown[];
    const bad = (await admin(p, { action: "runs", only_errors: true })).json.runs as Array<{
      content_id: string;
    }>;
    expect(all.length).toBeGreaterThan(bad.length);
    expect(bad.map((r) => r.content_id)).toContain("AdminBad001");
  });

  it("escapes wildcard characters in the run search", async () => {
    const p = await setup();
    const r = await admin(p, { action: "runs", q: "%" });
    expect(r.status).toBe(200);
    expect(r.json.runs).toEqual([]);
  });
});

describe("admin actions", () => {
  it("retries dead jobs: re-arms the job and sends the save back to the queue", async () => {
    const p = await setup();
    p.w.ig.set("AdminDead01", { status: 500, body: null });
    const s = await share(p.t, await newUser(p.t), IG("AdminDead01"));
    for (let i = 0; i < 5; i++) {
      await drainOnce(p.t.svc);
      await makeDue(p.t);
      await p.t.db.query("update provider_health set open_until = null");
    }
    expect((await admin(p, { action: "dead" })).json.jobs).toHaveLength(1);

    p.w.ig.set("AdminDead01", igMedia("AdminDead01", "Blue Tokai cafe"));
    const r = await admin(p, { action: "retry_job", id: s.jobId });
    expect(r.json.requeued).toBe(1);
    const save = (
      await p.t.db.query("select enrichment_status, status from saves where id = $1", [s.saveId])
    ).rows[0];
    expect(save).toMatchObject({ enrichment_status: "queued", status: "pending" });
    await drainOnce(p.t.svc);
    const done = (
      await p.t.db.query<{ enrichment_status: string }>(
        "select enrichment_status from saves where id = $1",
        [s.saveId],
      )
    ).rows[0];
    expect(done?.enrichment_status).toBe("done");
    expect((await admin(p, { action: "dead" })).json.jobs).toHaveLength(0);
  });

  it("toggles known feature flags (and refuses unknown ones) without a deploy", async () => {
    const p = await setup();
    expect(
      (await admin(p, { action: "set_flag", key: "frames_instagram_enabled", enabled: true })).json
        .enabled,
    ).toBe(true);
    const o = (await admin(p, { action: "overview" })).json;
    expect(o.flags.find((f: { key: string }) => f.key === "frames_instagram_enabled").enabled).toBe(
      true,
    );
    expect(o.flags.find((f: { key: string }) => f.key === "frames_youtube_enabled").enabled).toBe(
      false,
    ); // off by default
    expect(
      (await admin(p, { action: "set_flag", key: "made_up_flag", enabled: true })).status,
    ).toBe(400);
  });

  it("resets an open breaker", async () => {
    const p = await setup();
    await p.t.db.query("select provider_open_until('hikerapi', now() + interval '1 hour', 'test')");
    await admin(p, { action: "reset_breaker", provider: "hikerapi" });
    const row = (
      await p.t.db.query<{ open_until: Date | null }>(
        "select open_until from provider_health where provider = 'hikerapi'",
      )
    ).rows[0];
    expect(row?.open_until).toBeNull();
  });

  it("drain_now processes the queue and run_task runs a named task", async () => {
    const p = await setup();
    p.w.ig.set("AdminNow001", igMedia("AdminNow001", "Blue Tokai cafe"));
    await share(p.t, await newUser(p.t), IG("AdminNow001"));
    const d = await admin(p, { action: "drain_now" });
    expect(d.json).toMatchObject({ ok: true, claimed: 1, done: 1 });
    const t = await admin(p, { action: "run_task", name: "reaper" });
    expect(t.json.results).toMatchObject([{ name: "reaper", status: "ok" }]);
  });

  it("dry-runs a URL end to end with NO save and NO job, caching the analysis", async () => {
    const p = await setup();
    p.w.ig.set("AdminDry001", igMedia("AdminDry001", "Blue Tokai cafe"));
    const r = await admin(p, { action: "run_url", url: IG("AdminDry001") });
    expect(r.json).toMatchObject({ ok: true, outcome: "done" });
    expect((await p.t.db.query("select 1 from saves")).rowCount).toBe(0);
    expect((await p.t.db.query("select 1 from enrichment_jobs")).rowCount).toBe(0);
    expect((await p.t.db.query("select 1 from post_analysis")).rowCount).toBe(1);

    const events = (await admin(p, { action: "run_events", run_id: r.json.run_id })).json
      .events as Array<{ step: string; message: string }>;
    expect(events.map((e) => e.step)).toEqual(
      expect.arrayContaining(["canonicalize", "fetch", "writeback", "result"]),
    );
    expect(events.find((e) => e.step === "writeback")?.message).toMatch(/dry run/);

    // bypass_cache forgets the cached post so providers are called again
    const before = p.w.calls.hiker;
    await admin(p, { action: "run_url", url: IG("AdminDry001"), bypass_cache: true });
    expect(p.w.calls.hiker).toBe(before + 1);
  });

  it("reports a canonicalization failure as a traced error, not a crash", async () => {
    const p = await setup();
    const r = await admin(p, { action: "run_url", url: "http://169.254.169.254/x" });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(false);
    const events = (await admin(p, { action: "run_events", run_id: r.json.run_id })).json
      .events as Array<{ status: string }>;
    expect(events[0]?.status).toBe("error");
  });
});
