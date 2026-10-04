import { afterEach, describe, expect, it } from "vitest";
import { createDrainKicker } from "../src/scheduler/kicker.ts";
import { type TaskDef, runDueTasks } from "../src/scheduler/runner.ts";
import { MINUTE, dailyAt, every, nextRun, weeklyAt } from "../src/scheduler/schedule.ts";
import { type TestApp, createTestApp } from "./helpers/app.ts";
import {
  IG,
  igMedia,
  newUser,
  share,
  createPipelineTest,
  type PipelineTest,
} from "./helpers/world.ts";

describe("schedule arithmetic", () => {
  const at = (s: string) => new Date(s);

  it("every: adds the interval", () => {
    expect(nextRun(every(15 * MINUTE), at("2026-10-02T10:00:00Z")).toISOString()).toBe(
      "2026-10-02T10:15:00.000Z",
    );
  });

  it("daily: today if the slot is ahead, tomorrow if it has passed (strictly after)", () => {
    expect(nextRun(dailyAt("04:30"), at("2026-10-02T03:00:00Z")).toISOString()).toBe(
      "2026-10-02T04:30:00.000Z",
    );
    expect(nextRun(dailyAt("04:30"), at("2026-10-02T04:30:00Z")).toISOString()).toBe(
      "2026-10-03T04:30:00.000Z",
    );
    expect(nextRun(dailyAt("04:30"), at("2026-10-02T23:59:59Z")).toISOString()).toBe(
      "2026-10-03T04:30:00.000Z",
    );
  });

  it("weekly: lands on the right weekday and rolls over month ends", () => {
    // 2026-10-02 is a Friday; next Sunday 04:30 is 2026-10-04
    expect(nextRun(weeklyAt(0, "04:30"), at("2026-10-02T12:00:00Z")).toISOString()).toBe(
      "2026-10-04T04:30:00.000Z",
    );
    expect(nextRun(weeklyAt(0, "04:30"), at("2026-10-04T04:30:00Z")).toISOString()).toBe(
      "2026-10-11T04:30:00.000Z",
    );
    expect(nextRun(dailyAt("00:00"), at("2026-12-31T12:00:00Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("rejects malformed times", () => {
    expect(() => nextRun(dailyAt("25:00"), new Date())).toThrow();
    expect(() => nextRun(dailyAt("4:30"), new Date())).toThrow();
  });
});

describe("durable task runner", () => {
  let t: TestApp;
  afterEach(async () => {
    await t.db.close();
  });

  const counting = (name: string, schedule = every(MINUTE)) => {
    const state = { runs: 0 };
    const def: TaskDef = {
      name,
      schedule,
      async run() {
        state.runs++;
        await new Promise((r) => setTimeout(r, 25));
        return `run ${state.runs}`;
      },
    };
    return { state, def };
  };

  it("runs due interval tasks on the first tick and records state", async () => {
    t = await createTestApp();
    const { state, def } = counting("a");
    const r = await runDueTasks(t.svc, [def]);
    expect(r).toMatchObject([{ name: "a", status: "ok", detail: "run 1" }]);
    expect(state.runs).toBe(1);
    const row = (await t.db.query("select * from scheduled_tasks where name = 'a'")).rows[0];
    expect(row).toMatchObject({ last_status: "ok", run_count: 1, locked_until: null });
    expect((row!.next_run_at as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it("does not run a task before it is due, and calendar tasks wait for their slot", async () => {
    t = await createTestApp();
    const { state, def } = counting("a");
    await runDueTasks(t.svc, [def]);
    await runDueTasks(t.svc, [def]); // not due yet
    expect(state.runs).toBe(1);

    const daily = counting("d", dailyAt("04:30"));
    const res = await runDueTasks(t.svc, [daily.def]);
    expect(res[0]?.status).toBe("skipped"); // first run is the next 04:30, not now
    expect(daily.state.runs).toBe(0);
  });

  it("two concurrent ticks run a due task exactly once", async () => {
    t = await createTestApp();
    const { state, def } = counting("once");
    const [a, b] = await Promise.all([runDueTasks(t.svc, [def]), runDueTasks(t.svc, [def])]);
    expect(state.runs).toBe(1);
    expect([a[0]?.status, b[0]?.status].sort()).toEqual(["ok", "skipped"]);
  });

  it("a failing task is recorded, rescheduled, and does not stop the others", async () => {
    t = await createTestApp();
    const ok = counting("ok");
    const bad: TaskDef = {
      name: "bad",
      schedule: every(MINUTE),
      run: () => Promise.reject(new Error("boom")),
    };
    const results = await runDueTasks(t.svc, [bad, ok.def]);
    expect(results.map((r) => r.status)).toEqual(["error", "ok"]);
    const row = (
      await t.db.query(
        "select last_status, last_error, next_run_at, locked_until from scheduled_tasks where name = 'bad'",
      )
    ).rows[0];
    expect(row).toMatchObject({ last_status: "error", last_error: "boom", locked_until: null });
    expect((row!.next_run_at as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it("a crashed run's lock expires so the task is not stuck forever", async () => {
    t = await createTestApp();
    const { state, def } = counting("stuck");
    await runDueTasks(t.svc, [def]);
    await t.db.query(
      "update scheduled_tasks set next_run_at = now() - interval '1 minute', locked_until = now() + interval '5 minutes' where name = 'stuck'",
    );
    expect((await runDueTasks(t.svc, [def]))[0]?.status).toBe("skipped"); // lock still held
    await t.db.query(
      "update scheduled_tasks set locked_until = now() - interval '1 second' where name = 'stuck'",
    );
    expect((await runDueTasks(t.svc, [def]))[0]?.status).toBe("ok");
    expect(state.runs).toBe(2);
  });

  it("can be limited to named tasks", async () => {
    t = await createTestApp();
    const a = counting("a");
    const b = counting("b");
    await runDueTasks(t.svc, [a.def, b.def], ["b"]);
    expect([a.state.runs, b.state.runs]).toEqual([0, 1]);
  });
});

describe("POST /internal/tick", () => {
  let t: TestApp;
  afterEach(async () => {
    await t.db.close();
  });
  const SECRET = "t".repeat(32);

  it("is disabled without TICK_SECRET and rejects wrong or missing credentials", async () => {
    t = await createTestApp();
    expect((await t.call(null, "POST", "/internal/tick")).status).toBe(503);
    await t.db.close();
    t = await createTestApp({ env: { TICK_SECRET: SECRET } });
    expect((await t.call(null, "POST", "/internal/tick")).status).toBe(401);
    expect(
      (await t.call(null, "POST", "/internal/tick", undefined, { authorization: "Bearer nope" }))
        .status,
    ).toBe(401);
    expect(
      (await t.call(null, "POST", "/internal/tick", undefined, { "x-tick-secret": SECRET })).status,
    ).toBe(401);
  });

  it("with the secret it acknowledges immediately and runs due tasks (wait=true returns results)", async () => {
    t = await createTestApp({ env: { TICK_SECRET: SECRET } });
    const auth = { authorization: `Bearer ${SECRET}` };
    const waited = await t.call(null, "POST", "/internal/tick?wait=true", undefined, auth);
    expect(waited.status).toBe(200);
    const names = (waited.json.results as Array<{ name: string; status: string }>).map(
      (r) => r.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "drain",
        "reaper",
        "canary",
        "purge-cache",
        "housekeeping",
        "refresh-youtube",
      ]),
    );
    const drain = (waited.json.results as Array<{ name: string; status: string }>).find(
      (r) => r.name === "drain",
    );
    expect(drain?.status).toBe("ok");

    const fast = await t.call(null, "POST", "/internal/tick", undefined, auth);
    expect(fast.status).toBe(202);
  });

  it("a tick drains queued jobs end to end", async () => {
    const p: PipelineTest = await createPipelineTest({ TICK_SECRET: SECRET });
    t = p.t;
    p.w.ig.set("TickReel0001", igMedia("TickReel0001", "Blue Tokai cafe"));
    const s = await share(t, await newUser(t), IG("TickReel0001"));
    await t.call(null, "POST", "/internal/tick?wait=true", undefined, {
      authorization: `Bearer ${SECRET}`,
    });
    const save = (
      await t.db.query<{ enrichment_status: string; category: string }>(
        "select enrichment_status, category from saves where id = $1",
        [s.saveId],
      )
    ).rows[0];
    expect(save).toMatchObject({ enrichment_status: "done", category: "places" });
  });
});

describe("drain kicker", () => {
  it("processes a queued job immediately and collapses overlapping kicks", async () => {
    const p = await createPipelineTest();
    const { t, w } = p;
    try {
      w.ig.set("KickReel0001", igMedia("KickReel0001", "Blue Tokai cafe"));
      const s = await share(t, await newUser(t), IG("KickReel0001"));
      const kicker = createDrainKicker(t.svc);
      kicker.kick();
      kicker.kick(); // collapses into at most one follow-up run
      kicker.kick();
      await new Promise((r) => setTimeout(r, 1500));
      kicker.stop();
      expect(w.calls.hiker).toBe(1);
      const save = (
        await t.db.query<{ enrichment_status: string }>(
          "select enrichment_status from saves where id = $1",
          [s.saveId],
        )
      ).rows[0];
      expect(save?.enrichment_status).toBe("done");
    } finally {
      await t.db.close();
    }
  });
});
