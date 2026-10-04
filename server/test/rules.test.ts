import { afterEach, describe, expect, it } from "vitest";
import {
  type ParsedRule,
  type RuleTarget,
  evaluateRule,
  matchCondition,
  parseRuleReply,
} from "../src/domain/rules.ts";
import { makeSave } from "./helpers/factories.ts";
import { type PipelineTest, createPipelineTest } from "./helpers/world.ts";

const target = (over: Partial<RuleTarget> = {}): RuleTarget => ({
  title: null,
  caption: null,
  ai_description: null,
  note: null,
  source_username: null,
  source_url: null,
  source_platform: "instagram",
  ...over,
});
const rule = (over: Partial<ParsedRule> = {}): ParsedRule => ({
  conditions: [{ field: "caption", operator: "contains", value: "pasta" }],
  condition_logic: "AND",
  action: { set_category: "recipes" },
  ...over,
});

describe("rule reply parsing", () => {
  const valid = JSON.stringify(rule());

  it("accepts a valid rule, with or without a markdown fence, and strips unknown keys", () => {
    expect(parseRuleReply(valid)).toEqual({ ok: true, rule: rule() });
    expect(parseRuleReply("```json\n" + valid + "\n```")).toMatchObject({ ok: true });
    const extra = JSON.stringify({
      ...rule(),
      action: { set_category: "recipes", set_tags: ["x"], add_to_board: "b" },
    });
    const r = parseRuleReply(extra);
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.rule.action).toEqual({ set_category: "recipes" });
  });

  it("passes the model's own 'error' reason through to the user", () => {
    expect(parseRuleReply('{"error":"Rules about time of day are not supported"}')).toEqual({
      ok: false,
      error: "Rules about time of day are not supported",
    });
  });

  it.each([
    ["not JSON", "I think you want recipes"],
    ["an invented category", JSON.stringify(rule({ action: { set_category: "HACKED" as never } }))],
    ["a null category", JSON.stringify({ ...rule(), action: { set_category: null } })],
    ["a missing action", JSON.stringify({ conditions: rule().conditions, condition_logic: "AND" })],
    [
      "an unsupported field",
      JSON.stringify({
        ...rule(),
        conditions: [{ field: "time_of_day", operator: "contains", value: "x" }],
      }),
    ],
    [
      "an unsupported operator",
      JSON.stringify({
        ...rule(),
        conditions: [{ field: "caption", operator: "matches_regex", value: "(a+)+$" }],
      }),
    ],
    ["no conditions", JSON.stringify(rule({ conditions: [] }))],
    [
      "an empty value",
      JSON.stringify({
        ...rule(),
        conditions: [{ field: "caption", operator: "contains", value: "" }],
      }),
    ],
  ])("rejects %s", (_label, raw) => {
    expect(parseRuleReply(raw).ok).toBe(false);
  });
});

describe("rule evaluation", () => {
  it("contains / not_contains / equals are case-insensitive and support any-of arrays", () => {
    const s = target({ title: "Weeknight PASTA", source_platform: "YouTube" });
    expect(matchCondition(s, { field: "caption", operator: "contains", value: "pasta" })).toBe(
      true,
    );
    expect(
      matchCondition(s, { field: "caption", operator: "contains", value: ["pizza", "Weeknight"] }),
    ).toBe(true);
    expect(
      matchCondition(s, { field: "caption", operator: "contains", value: ["pizza", "sushi"] }),
    ).toBe(false);
    expect(
      matchCondition(s, { field: "caption", operator: "not_contains", value: ["pizza", "sushi"] }),
    ).toBe(true);
    expect(
      matchCondition(s, { field: "caption", operator: "not_contains", value: ["pizza", "pasta"] }),
    ).toBe(false);
    expect(matchCondition(s, { field: "platform", operator: "equals", value: "youtube" })).toBe(
      true,
    );
    expect(
      matchCondition(s, { field: "platform", operator: "equals", value: ["web", "YOUTUBE"] }),
    ).toBe(true);
    expect(matchCondition(s, { field: "platform", operator: "equals", value: "you" })).toBe(false);
  });

  it("'caption' searches title, caption, description and note; 'username' uses the handle, not the url", () => {
    expect(evaluateRule(target({ note: "try the pasta" }), rule())).toBe(true);
    expect(evaluateRule(target({ ai_description: "A pasta recipe" }), rule())).toBe(true);
    expect(evaluateRule(target({ caption: "pasta night" }), rule())).toBe(true);
    const byUser = rule({
      conditions: [{ field: "username", operator: "equals", value: "foodie" }],
    });
    expect(evaluateRule(target({ source_username: "Foodie" }), byUser)).toBe(true);
    expect(
      evaluateRule(target({ source_url: "https://instagram.com/foodie/reel/x" }), byUser),
    ).toBe(false);
  });

  it("AND needs every condition, OR needs one", () => {
    const conditions: ParsedRule["conditions"] = [
      { field: "caption", operator: "contains", value: "pasta" },
      { field: "platform", operator: "equals", value: "youtube" },
    ];
    const s = target({ title: "pasta", source_platform: "instagram" });
    expect(evaluateRule(s, rule({ conditions, condition_logic: "AND" }))).toBe(false);
    expect(evaluateRule(s, rule({ conditions, condition_logic: "OR" }))).toBe(true);
  });
});

describe("rules API", () => {
  const open: PipelineTest[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((p) => p.t.db.close()));
  });
  const setup = async () => {
    const p = await createPipelineTest();
    open.push(p);
    p.w.copyText = JSON.stringify(rule());
    return p;
  };

  it("creates a rule from plain text, validated, and lists it", async () => {
    const p = await setup();
    const u = await p.t.makeUser("r1");
    const r = await p.t.call(u, "POST", "/v1/rules", { text: "anything about pasta is a recipe" });
    expect(r.status).toBe(201);
    expect(r.json.rule).toMatchObject({
      raw_text: "anything about pasta is a recipe",
      is_active: true,
      hit_count: 0,
    });
    expect(r.json.rule.parsed_logic.action.set_category).toBe("recipes");
    expect((await p.t.call(u, "GET", "/v1/rules")).json.rules).toHaveLength(1);
    // the rule text reaches the model as the user message, with the system prompt that narrows the schema
    const sent = p.w.calls.anthropic[0]!.request as {
      system: string;
      messages: Array<{ content: string }>;
    };
    expect(sent.messages[0]!.content).toBe("anything about pasta is a recipe");
    expect(sent.system).toContain("NOT supported");
  });

  it("returns 422 with the model's reason when a rule cannot be expressed, and stores nothing", async () => {
    const p = await setup();
    p.w.copyText = '{"error":"Time-of-day rules are not supported"}';
    const u = await p.t.makeUser("r2");
    const r = await p.t.call(u, "POST", "/v1/rules", {
      text: "save things I add at night as inspo",
    });
    expect(r.status).toBe(422);
    expect(r.json.error).toMatchObject({
      code: "rule_not_understood",
      message: "Time-of-day rules are not supported",
    });
    expect((await p.t.call(u, "GET", "/v1/rules")).json.rules).toHaveLength(0);
  });

  it("never stores unvalidated model output", async () => {
    const p = await setup();
    p.w.copyText = JSON.stringify({
      conditions: [{ field: "caption", operator: "contains", value: "x" }],
      condition_logic: "AND",
    });
    const u = await p.t.makeUser("r3");
    expect((await p.t.call(u, "POST", "/v1/rules", { text: "something vague here" })).status).toBe(
      422,
    );
    expect((await p.t.db.query("select 1 from user_rules")).rowCount).toBe(0);
  });

  it("reports 503 when the model is unavailable and validates input", async () => {
    const p = await setup();
    p.w.copyText = null; // model API returns 500
    const u = await p.t.makeUser("r4");
    expect((await p.t.call(u, "POST", "/v1/rules", { text: "pasta is a recipe" })).status).toBe(
      503,
    );
    expect((await p.t.call(u, "POST", "/v1/rules", { text: "x" })).status).toBe(400);
    expect((await p.t.call(u, "POST", "/v1/rules", { text: "y".repeat(501) })).status).toBe(400);
    expect((await p.t.call(u, "POST", "/v1/rules", { text: "pasta", extra: 1 })).status).toBe(400);
  });

  it("caps rules per user and rate limits creation", async () => {
    const p = await setup();
    const u = await p.t.makeUser("r5");
    for (let i = 0; i < 50; i++) {
      await p.t.db.query(
        "insert into user_rules (user_id, raw_text, parsed_logic) values ($1, 'r', $2::jsonb)",
        [u, JSON.stringify(rule())],
      );
    }
    const r = await p.t.call(u, "POST", "/v1/rules", { text: "one more rule" });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("rule_limit");

    const v = await p.t.makeUser("r6");
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++)
      statuses.push((await p.t.call(v, "POST", "/v1/rules", { text: `rule number ${i}` })).status);
    expect(statuses.filter((s) => s === 429).length).toBe(2);
  });

  it("toggles, deletes, and isolates rules between users", async () => {
    const p = await setup();
    const a = await p.t.makeUser("ra");
    const b = await p.t.makeUser("rb");
    const id = (await p.t.call(a, "POST", "/v1/rules", { text: "pasta is a recipe" })).json.rule
      .id as string;
    expect((await p.t.call(b, "PATCH", `/v1/rules/${id}`, { is_active: false })).status).toBe(404);
    expect((await p.t.call(b, "DELETE", `/v1/rules/${id}`)).status).toBe(404);
    expect((await p.t.call(b, "POST", `/v1/rules/${id}/apply`)).status).toBe(404);
    expect((await p.t.call(b, "GET", "/v1/rules")).json.rules).toHaveLength(0);
    expect(
      (await p.t.call(a, "PATCH", `/v1/rules/${id}`, { is_active: false })).json.rule.is_active,
    ).toBe(false);
    expect((await p.t.call(a, "DELETE", `/v1/rules/${id}`)).status).toBe(204);
  });

  describe("retroactive apply", () => {
    it("recategorizes matching live saves, leaves others and archived saves alone, and is idempotent", async () => {
      const p = await setup();
      const u = await p.t.makeUser("ap");
      const other = await p.t.makeUser("ap2");
      const id = (await p.t.call(u, "POST", "/v1/rules", { text: "pasta is a recipe" })).json.rule
        .id as string;
      const hit = await makeSave(p.t.db, u, { category: "inspo", title: "Creamy PASTA" });
      const already = await makeSave(p.t.db, u, { category: "recipes", title: "pasta again" });
      const miss = await makeSave(p.t.db, u, { category: "inspo", title: "sunset" });
      const archived = await makeSave(p.t.db, u, {
        category: "inspo",
        title: "pasta old",
        archived: true,
      });
      const foreign = await makeSave(p.t.db, other, { category: "inspo", title: "pasta not mine" });

      const r = await p.t.call(u, "POST", `/v1/rules/${id}/apply`);
      expect(r.json).toEqual({ matched: 2, updated: 1 });
      const cat = async (s: string) =>
        (await p.t.db.query<{ category: string }>("select category from saves where id = $1", [s]))
          .rows[0]?.category;
      expect(await cat(hit)).toBe("recipes");
      expect(await cat(already)).toBe("recipes");
      expect(await cat(miss)).toBe("inspo");
      expect(await cat(archived)).toBe("inspo");
      expect(await cat(foreign)).toBe("inspo"); // another user's data is never touched

      expect((await p.t.call(u, "POST", `/v1/rules/${id}/apply`)).json).toEqual({
        matched: 2,
        updated: 0,
      });
      const rule = (
        await p.t.db.query<{ hit_count: number }>(
          "select hit_count from user_rules where id = $1",
          [id],
        )
      ).rows[0];
      expect(rule?.hit_count).toBe(1); // counts real changes, not re-evaluations
    });

    it("refuses to apply an inactive rule", async () => {
      const p = await setup();
      const u = await p.t.makeUser("ina");
      const id = (await p.t.call(u, "POST", "/v1/rules", { text: "pasta is a recipe" })).json.rule
        .id as string;
      await p.t.call(u, "PATCH", `/v1/rules/${id}`, { is_active: false });
      const r = await p.t.call(u, "POST", `/v1/rules/${id}/apply`);
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe("rule_inactive");
    });

    it("covers every save, not just the first page (1,200 saves)", async () => {
      const p = await setup();
      const u = await p.t.makeUser("big");
      const id = (await p.t.call(u, "POST", "/v1/rules", { text: "pasta is a recipe" })).json.rule
        .id as string;
      await p.t.db.query(
        `insert into saves (user_id, source_platform, category, title, created_at)
         select $1, 'web', 'inspo', 'pasta ' || g, now() - make_interval(secs => g) from generate_series(1, 1200) g`,
        [u],
      );
      const r = await p.t.call(u, "POST", `/v1/rules/${id}/apply`);
      expect(r.json).toEqual({ matched: 1200, updated: 1200 });
      const left = await p.t.db.query(
        "select 1 from saves where user_id = $1 and category <> 'recipes'",
        [u],
      );
      expect(left.rowCount).toBe(0);
    });
  });
});
