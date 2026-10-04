import { afterEach, describe, expect, it } from "vitest";
import {
  WEEKLY_CAP,
  applyGates,
  birthdayTarget,
  buildCopyPrompt,
  clipBody,
  fallbackCopy,
  firstNameOf,
  formsLongWeekend,
  isQuietHours,
  longWeekendWindow,
  reminderBody,
  triggerEnabled,
} from "../src/domain/resurface.ts";
import { runReminders, runResurface, type EngineDeps } from "../src/domain/resurfaceEngine.ts";
import type { CandidateSave } from "../src/db/repos/resurface.ts";
import { type PipelineTest, createPipelineTest } from "./helpers/world.ts";
import { makeLocation, makeSave } from "./helpers/factories.ts";

const at = (s: string) => new Date(s);
const save = (id: string, over: Partial<CandidateSave> = {}): CandidateSave => ({
  id,
  category: "places",
  title: `Save ${id}`,
  ai_description: null,
  note: null,
  ...over,
});
const hist = (sentAt: string, ids: string[] = []) => ({ sent_at: at(sentAt), save_ids: ids });

describe("time rules (IST)", () => {
  it("quiet hours are 21:00–09:00 IST", () => {
    // 04:30Z = 10:00 IST
    expect(isQuietHours(at("2026-10-15T04:30:00Z"))).toBe(false);
    expect(isQuietHours(at("2026-10-15T03:29:00Z"))).toBe(true); // 08:59 IST
    expect(isQuietHours(at("2026-10-15T03:30:00Z"))).toBe(false); // 09:00 IST
    expect(isQuietHours(at("2026-10-15T15:29:00Z"))).toBe(false); // 20:59 IST
    expect(isQuietHours(at("2026-10-15T15:30:00Z"))).toBe(true); // 21:00 IST
  });

  it("the long-weekend window is 2–4 days ahead in IST dates", () => {
    expect(longWeekendWindow(at("2026-10-15T04:30:00Z"))).toEqual({
      from: "2026-10-17",
      to: "2026-10-19",
    });
    // 23:00Z is already the next day in IST
    expect(longWeekendWindow(at("2026-10-15T23:00:00Z"))).toEqual({
      from: "2026-10-18",
      to: "2026-10-20",
    });
  });

  it("birthdays fire exactly 8 days ahead, across month and year ends", () => {
    expect(birthdayTarget(at("2026-10-15T05:00:00Z"))).toEqual({
      month: 10,
      day: 23,
      includeFeb29: false,
    });
    expect(birthdayTarget(at("2026-12-28T05:00:00Z"))).toEqual({
      month: 1,
      day: 5,
      includeFeb29: false,
    });
  });

  it("observes 29 Feb birthdays on 28 Feb in non-leap years only", () => {
    expect(birthdayTarget(at("2027-02-20T05:00:00Z"))).toEqual({
      month: 2,
      day: 28,
      includeFeb29: true,
    });
    expect(birthdayTarget(at("2028-02-20T05:00:00Z"))).toEqual({
      month: 2,
      day: 28,
      includeFeb29: false,
    });
    expect(birthdayTarget(at("2028-02-21T05:00:00Z"))).toEqual({
      month: 2,
      day: 29,
      includeFeb29: false,
    });
  });

  it("only Monday/Friday holidays bridge into a long weekend; explicit long weekends always count", () => {
    expect(formsLongWeekend({ name: "x", type: "long_weekend", date: "2026-10-14" })).toBe(true); // Wed
    expect(formsLongWeekend({ name: "x", type: "holiday", date: "2026-10-16" })).toBe(true); // Fri
    expect(formsLongWeekend({ name: "x", type: "festival", date: "2026-10-19" })).toBe(true); // Mon
    expect(formsLongWeekend({ name: "x", type: "holiday", date: "2026-10-14" })).toBe(false); // Wed
  });
});

describe("guard pipeline", () => {
  const now = at("2026-10-15T05:00:00Z");
  const cands = [save("a"), save("b"), save("c")];

  it("gate 1: no candidates", () => {
    expect(applyGates([], [], now)).toEqual({ pass: false, reason: "no_matching_saves" });
  });

  it("gate 2: weekly cap and 3-day spacing", () => {
    const two = [hist("2026-10-09T05:00:00Z"), hist("2026-10-12T04:00:00Z")];
    expect(applyGates(cands, two, now)).toMatchObject({
      pass: false,
      reason: "throttled_weekly_cap",
    });
    expect(WEEKLY_CAP).toBe(2);
    expect(applyGates(cands, [hist("2026-10-13T06:00:00Z")], now)).toMatchObject({
      pass: false,
      reason: "throttled_3_day_interval",
    });
    // exactly 3 days ago passes
    expect(applyGates(cands, [hist("2026-10-12T05:00:00Z")], now).pass).toBe(true);
    // one send 8 days ago is outside the weekly window
    expect(applyGates(cands, [hist("2026-10-07T05:00:00Z")], now).pass).toBe(true);
  });

  it("gate 3: drops saves notified in the last 30 days, then picks the top two fresh ones", () => {
    const r = applyGates(cands, [hist("2026-09-20T05:00:00Z", ["a"])], now);
    expect(r).toMatchObject({ pass: true });
    expect(r.pass && r.saves.map((s) => s.id)).toEqual(["b", "c"]);
    expect(applyGates([save("a")], [hist("2026-09-20T05:00:00Z", ["a"])], now)).toMatchObject({
      pass: false,
      reason: "all_saves_recently_notified",
    });
    // 31 days ago no longer counts
    expect(applyGates([save("a")], [hist("2026-09-14T05:00:00Z", ["a"])], now).pass).toBe(true);
  });

  it("user preferences: only an explicit false disables a trigger", () => {
    expect(triggerEnabled("birthday", null)).toBe(true);
    expect(triggerEnabled("birthday", {})).toBe(true);
    expect(triggerEnabled("birthday", { birthday: true })).toBe(true);
    expect(triggerEnabled("birthday", { birthday: false })).toBe(false);
    expect(triggerEnabled("new_city", { birthday: false })).toBe(true);
  });
});

describe("copy", () => {
  it("builds a specific prompt per trigger and keeps the brand consistent", () => {
    const saves = [save("a", { title: "Rooftop café" })];
    const lw = buildCopyPrompt(
      { type: "long_weekend", categories: ["places"], label: "Diwali break" },
      saves,
      "Asha",
    );
    expect(lw).toContain("Diwali break");
    expect(lw).toContain('"Rooftop café" (places)');
    expect(lw).toContain("Asha");
    expect(lw).toContain("Dibs");
    expect(lw).not.toContain("Resurface");
    expect(buildCopyPrompt({ type: "birthday", categories: [], label: "" }, saves, "")).toContain(
      "the user's birthday",
    );
    expect(
      buildCopyPrompt({ type: "new_city", categories: [], label: "Goa" }, saves, "A"),
    ).toContain("arrived in Goa");
  });

  it("falls back sensibly and clips runaway replies", () => {
    expect(fallbackCopy({ type: "new_city", categories: [], label: "Goa" })).toContain(
      "You're in Goa",
    );
    expect(fallbackCopy({ type: "birthday", categories: [], label: "" })).toContain("birthday");
    expect(clipBody('  "Short and sweet."  ')).toBe("Short and sweet.");
    const long = clipBody("word ".repeat(100));
    expect(long.length).toBeLessThanOrEqual(178);
    expect(long.endsWith("…")).toBe(true);
  });

  it("formats reminders and first names", () => {
    expect(reminderBody({ title: "Toit", ai_description: null, note: "book a table" })).toBe(
      'You asked to be reminded: "book a table"',
    );
    expect(reminderBody({ title: "Toit", ai_description: null, note: null })).toContain('"Toit"');
    expect(reminderBody({ title: null, ai_description: null, note: null })).toContain(
      "your saved item",
    );
    expect(firstNameOf("Asha Rao")).toBe("Asha");
    expect(firstNameOf(null)).toBe("");
  });
});

describe("resurface engine", () => {
  const open: PipelineTest[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((p) => p.t.db.close()));
  });

  // 10:30 IST on a Thursday; long-weekend window is 2026-10-17..2026-10-19
  const NOW = at("2026-10-15T05:00:00Z");
  const deps = (p: PipelineTest, now: Date = NOW): EngineDeps => ({
    db: p.t.db,
    llm: p.t.svc.llm,
    push: p.t.svc.push,
    config: p.t.svc.config,
    log: p.t.svc.log,
    now: () => now,
  });
  const setup = async () => {
    const p = await createPipelineTest();
    open.push(p);
    return p;
  };
  const addEvent = (p: PipelineTest, name: string, type: string, date: string) =>
    p.t.db.query(
      "insert into calendar_events (name, type, date) values ($1, $2, $3) on conflict do nothing",
      [name, type, date],
    );
  const addToken = (
    p: PipelineTest,
    userId: string,
    token = `ExponentPushToken[${userId.slice(0, 8)}]`,
  ) =>
    p.t.db.query("insert into device_tokens (user_id, expo_push_token) values ($1, $2)", [
      userId,
      token,
    ]);
  const logRows = async (p: PipelineTest) =>
    (
      await p.t.db.query<{ trigger_type: string; save_ids: string[]; copy: string }>(
        "select trigger_type, save_ids, copy from notification_log order by sent_at",
      )
    ).rows;

  it("sends a long-weekend nudge about the user's saved places, and logs it", async () => {
    const p = await setup();
    await addEvent(p, "Test Break", "long_weekend", "2026-10-18");
    const u = await p.t.makeUser("lw");
    const s = await makeSave(p.t.db, u, {
      category: "places",
      title: "Rooftop café",
      is_favorite: true,
    });
    await makeSave(p.t.db, u, { category: "recipes" });
    await addToken(p, u);

    const summary = await runResurface(deps(p));
    expect(summary.long_weekend).toMatchObject({ label: "Test Break", evaluated: 1, sent: 1 });
    expect(p.w.calls.expo).toHaveLength(1);
    const msg = p.w.calls.expo[0]![0]!;
    expect(msg).toMatchObject({ title: "Dibs", priority: "normal", sound: "default" });
    expect(msg.data).toMatchObject({ save_id: s, trigger_type: "long_weekend" });
    const rows = await logRows(p);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      trigger_type: "long_weekend",
      save_ids: [s],
      copy: p.w.copyText,
    });
    expect(msg.data.log_id).toBeTruthy();
    // the model prompt carried the real detail
    expect(JSON.stringify(p.w.calls.anthropic[0]!.request)).toContain("Rooftop café");
  });

  it("does nothing during quiet hours and without a long weekend", async () => {
    const p = await setup();
    await addEvent(p, "Test Break", "long_weekend", "2026-10-18");
    expect(await runResurface(deps(p, at("2026-10-15T20:00:00Z")))).toEqual({
      skipped: "quiet_hours",
    });
    expect(p.w.calls.expo).toHaveLength(0);
    const none = await runResurface(deps(p, at("2026-03-01T05:00:00Z")));
    expect(none.long_weekend).toEqual({ skipped: "no_long_weekend_detected" });
  });

  it("a plain mid-week holiday does not make a long weekend", async () => {
    const p = await setup();
    await addEvent(p, "Midweek Holiday", "holiday", "2026-10-17"); // Saturday: not a bridge day
    const u = await p.t.makeUser("mw");
    await makeSave(p.t.db, u, { category: "places" });
    await addToken(p, u);
    expect((await runResurface(deps(p))).long_weekend).toEqual({
      skipped: "no_long_weekend_detected",
    });
  });

  it("respects relevance, preferences and missing devices", async () => {
    const p = await setup();
    await addEvent(p, "Test Break", "long_weekend", "2026-10-18");
    const noSaves = await p.t.makeUser("ns"); // has only an acted-on place
    await makeSave(p.t.db, noSaves, { category: "places", acted_on: true });
    const off = await p.t.makeUser("off");
    await makeSave(p.t.db, off, { category: "places" });
    await addToken(p, off);
    await p.t.db.query(
      `update users set notification_prefs = '{"long_weekend":false}' where id = $1`,
      [off],
    );
    const noDevice = await p.t.makeUser("nd");
    await makeSave(p.t.db, noDevice, { category: "places" });

    const s = await runResurface(deps(p));
    expect(s.long_weekend).toMatchObject({ evaluated: 2, sent: 0 }); // noSaves is not even a candidate
    expect(p.w.calls.expo).toHaveLength(0);
    expect(await logRows(p)).toHaveLength(0);
  });

  it("throttles: a second run the same day sends nothing (3-day spacing)", async () => {
    const p = await setup();
    await addEvent(p, "Test Break", "long_weekend", "2026-10-18");
    const u = await p.t.makeUser("th");
    await makeSave(p.t.db, u, { category: "places" });
    await addToken(p, u);
    await runResurface(deps(p));
    const again = await runResurface(deps(p, at("2026-10-15T09:00:00Z")));
    expect(again.long_weekend).toMatchObject({ sent: 0 });
    expect(p.w.calls.expo).toHaveLength(1);
  });

  it("triggers run sequentially: a user due for two triggers gets ONE notification", async () => {
    const p = await setup();
    await addEvent(p, "Test Break", "long_weekend", "2026-10-18");
    const u = await p.t.makeUser("both");
    await makeSave(p.t.db, u, { category: "places" });
    await addToken(p, u);
    await p.t.db.query("update users set birthday = '1994-10-23' where id = $1", [u]); // 8 days after NOW

    const s = await runResurface(deps(p));
    expect(s.long_weekend).toMatchObject({ sent: 1 });
    expect(s.birthday).toMatchObject({ evaluated: 1, sent: 0 }); // blocked by the 3-day spacing gate
    expect(await logRows(p)).toHaveLength(1);
  });

  it("birthday trigger uses fashion/places saves and honours 29 Feb in non-leap years", async () => {
    const p = await setup();
    const u = await p.t.makeUser("bd");
    await makeSave(p.t.db, u, { category: "fashion", title: "Silk co-ord" });
    await addToken(p, u);
    await p.t.db.query("update users set birthday = '1996-02-29' where id = $1", [u]);
    const feb = at("2027-02-20T05:00:00Z"); // target 28 Feb 2027 (non-leap)
    const s = await runResurface(deps(p, feb));
    expect(s.birthday).toMatchObject({ evaluated: 1, sent: 1 });
    expect((await logRows(p))[0]).toMatchObject({ trigger_type: "birthday" });
  });

  it("new-city trigger uses the user's OWN saves located in the city they are in", async () => {
    const p = await setup();
    const traveler = await p.t.makeUser("trav");
    const other = await p.t.makeUser("other");
    await p.t.db.query(
      "update users set home_city = 'Bengaluru', current_city = 'Goa' where id = $1",
      [traveler],
    );
    const goa = await makeSave(p.t.db, traveler, { category: "places", title: "Beach shack" });
    await makeLocation(p.t.db, goa, { city: "Goa" });
    const blr = await makeSave(p.t.db, traveler, { category: "places", title: "Home café" });
    await makeLocation(p.t.db, blr, { city: "Bengaluru" });
    const strangers = await makeSave(p.t.db, other, { category: "places", title: "Not yours" });
    await makeLocation(p.t.db, strangers, { city: "Goa" });
    await addToken(p, traveler);

    const s = await runResurface(deps(p));
    expect(s.new_city).toMatchObject({ evaluated: 1, sent: 1 });
    const rows = await logRows(p);
    expect(rows[0]).toMatchObject({ trigger_type: "new_city", save_ids: [goa] });
    const prompt = JSON.stringify(p.w.calls.anthropic.at(-1)!.request);
    expect(prompt).toContain("Beach shack");
    expect(prompt).not.toContain("Not yours");
    expect(prompt).not.toContain("Home café");
  });

  it("new-city: users with the preference off, or at home, are skipped", async () => {
    const p = await setup();
    const off = await p.t.makeUser("noff");
    await p.t.db.query(
      `update users set home_city = 'A', current_city = 'B', notification_prefs = '{"new_city":false}' where id = $1`,
      [off],
    );
    const home = await p.t.makeUser("home");
    await p.t.db.query("update users set home_city = 'Goa', current_city = 'goa' where id = $1", [
      home,
    ]);
    expect((await runResurface(deps(p))).new_city).toEqual({ skipped: "no_users_away" });
  });

  it("uses fallback copy when the model is unavailable, so approved notifications still go out", async () => {
    const p = await setup();
    p.w.copyText = null; // model API returns 500
    await addEvent(p, "Test Break", "long_weekend", "2026-10-18");
    const u = await p.t.makeUser("fb");
    await makeSave(p.t.db, u, { category: "places" });
    await addToken(p, u);
    await runResurface(deps(p));
    expect(await logRows(p)).toMatchObject([
      { copy: "Test Break is coming up. You've got some great places saved." },
    ]);
    expect(p.w.calls.expo).toHaveLength(1);
  });

  it("when nothing is delivered the log row is removed so the user is not throttled for a push that never landed", async () => {
    const p = await setup();
    p.w.expoTickets = () => "http_error";
    await addEvent(p, "Test Break", "long_weekend", "2026-10-18");
    const u = await p.t.makeUser("pf");
    await makeSave(p.t.db, u, { category: "places" });
    await addToken(p, u);
    const s = await runResurface(deps(p));
    expect(s.long_weekend).toMatchObject({ sent: 0 });
    expect(await logRows(p)).toHaveLength(0);
  });

  it("prunes dead device tokens and still delivers to live ones", async () => {
    const p = await setup();
    p.w.expoTickets = (messages) =>
      messages.map((m) =>
        String(m.to).includes("DEAD")
          ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }
          : { status: "ok", id: "t" },
      );
    await addEvent(p, "Test Break", "long_weekend", "2026-10-18");
    const u = await p.t.makeUser("pr");
    await makeSave(p.t.db, u, { category: "places" });
    await addToken(p, u, "ExponentPushToken[DEAD]");
    await addToken(p, u, "ExponentPushToken[LIVE]");
    const s = await runResurface(deps(p));
    expect(s.long_weekend).toMatchObject({ sent: 1 });
    const left = await p.t.db.query<{ expo_push_token: string }>(
      "select expo_push_token from device_tokens",
    );
    expect(left.rows.map((r) => r.expo_push_token)).toEqual(["ExponentPushToken[LIVE]"]);
  });

  it("sends push in chunks of 100 messages", async () => {
    const p = await setup();
    const users: string[] = [];
    for (let i = 0; i < 3; i++) users.push(await p.t.makeUser(`chunk${i}`));
    const { createPushSender } = await import("../src/push/expo.ts");
    const sender = createPushSender({ fetch: p.w.fetch, db: p.t.db, log: p.t.svc.log });
    const messages = Array.from({ length: 250 }, (_, i) => ({
      to: `ExponentPushToken[t${i}]`,
      title: "t",
      body: "b",
      priority: "normal" as const,
      data: {},
    }));
    const r = await sender.send(messages);
    expect(p.w.calls.expo.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(r).toMatchObject({ ok: 250, failed: 0, transportFailure: false });
    void users;
  });

  describe("custom reminders", () => {
    it("delivers a due reminder once, to every device, even across overlapping ticks", async () => {
      const p = await setup();
      const u = await p.t.makeUser("rem");
      const s = await makeSave(p.t.db, u, {
        title: "Toit",
        note: "book a table",
        remind_at: new Date(NOW.getTime() - 60_000),
      });
      await addToken(p, u, "ExponentPushToken[d1]");
      await addToken(p, u, "ExponentPushToken[d2]");

      const [a, b] = await Promise.all([runReminders(deps(p)), runReminders(deps(p))]);
      expect(p.w.calls.expo.flat()).toHaveLength(2); // two devices, one reminder, sent once
      const body = p.w.calls.expo[0]![0]!;
      expect(body).toMatchObject({ title: "Reminder from Dibs", priority: "high" });
      expect(body.body).toBe('You asked to be reminded: "book a table"');
      expect(body.data).toMatchObject({ save_id: s, trigger_type: "custom_reminder" });
      expect([a.claimed ?? 0, b.claimed ?? 0].sort()).toEqual([0, 1]);
      expect((await runReminders(deps(p))).skipped).toBe("no_due_reminders");
      const row = (
        await p.t.db.query<{ reminded_at: Date }>("select reminded_at from saves where id = $1", [
          s,
        ])
      ).rows[0];
      expect(row?.reminded_at).toBeTruthy();
    });

    it("ignores future and archived reminders, and holds everything during quiet hours", async () => {
      const p = await setup();
      const u = await p.t.makeUser("rq");
      await addToken(p, u);
      await makeSave(p.t.db, u, { remind_at: new Date(NOW.getTime() + 3_600_000) });
      await makeSave(p.t.db, u, { remind_at: new Date(NOW.getTime() - 60_000), archived: true });
      const due = await makeSave(p.t.db, u, { remind_at: new Date(NOW.getTime() - 60_000) });

      expect(await runReminders(deps(p, at("2026-10-15T20:00:00Z")))).toEqual({
        skipped: "quiet_hours",
      });
      expect(p.w.calls.expo).toHaveLength(0); // still due, nothing consumed
      const r = await runReminders(deps(p));
      expect(r).toMatchObject({ claimed: 1, delivered: 1 });
      expect(JSON.stringify(p.w.calls.expo)).toContain(due);
    });

    it("consumes a reminder for a user with no device, but retries when Expo itself is unreachable", async () => {
      const p = await setup();
      const noDevice = await p.t.makeUser("rnd");
      const nd = await makeSave(p.t.db, noDevice, { remind_at: new Date(NOW.getTime() - 60_000) });
      const withDevice = await p.t.makeUser("rwd");
      const wd = await makeSave(p.t.db, withDevice, {
        remind_at: new Date(NOW.getTime() - 60_000),
      });
      await addToken(p, withDevice);

      p.w.expoTickets = () => "http_error";
      const first = await runReminders(deps(p));
      expect(first).toMatchObject({ claimed: 2, delivered: 0, retried: 1 });
      const state = async (id: string) =>
        (
          await p.t.db.query<{ reminded_at: Date | null }>(
            "select reminded_at from saves where id = $1",
            [id],
          )
        ).rows[0]?.reminded_at;
      expect(await state(nd)).toBeTruthy(); // consumed: nobody to tell
      expect(await state(wd)).toBeNull(); // released: try again next tick

      p.w.expoTickets = (m) => m.map(() => ({ status: "ok" }));
      expect(await runReminders(deps(p))).toMatchObject({ claimed: 1, delivered: 1 });
    });
  });
});
