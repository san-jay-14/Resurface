import { Hono } from "hono";
import { z } from "zod";
import { parseRuleText } from "../../domain/rules.ts";
import { ProviderError } from "../../adapters/types.ts";
import {
  applyRuleRetroactively,
  countRules,
  createRule,
  deleteRule,
  listRules,
  setRuleActive,
} from "../../db/repos/rules.ts";
import { AppError, conflict, notFound } from "../../errors.ts";
import { ProviderUnavailable } from "../../pipeline/health.ts";
import type { AppEnv, Services } from "../context.ts";
import { rateLimit } from "../middleware.ts";
import { jsonBody, pathParams } from "../validate.ts";

const MAX_RULES = 50;
const idParam = z.object({ id: z.uuid() });

export function ruleRoutes(svc: Services): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const { db } = svc;

  r.get("/rules", async (c) => c.json({ rules: await listRules(db, c.get("userId")) }));

  // Each creation is a paid model call, so it is rate limited and capped per user.
  r.post(
    "/rules",
    rateLimit({ windowMs: 60_000, max: 10, key: (c) => `rules:${c.get("userId")}` }),
    async (c) => {
      const userId = c.get("userId");
      const { text } = await jsonBody(
        c,
        z.object({ text: z.string().trim().min(3).max(500) }).strict(),
      );
      if ((await countRules(db, userId)) >= MAX_RULES) {
        throw new AppError(422, "rule_limit", `You can have up to ${MAX_RULES} rules.`);
      }
      let parsed;
      try {
        parsed = await parseRuleText(svc.llm, svc.config.pipeline.rulesModel, text);
      } catch (err) {
        if (err instanceof ProviderError || err instanceof ProviderUnavailable) {
          throw new AppError(
            503,
            "ai_unavailable",
            "Rules are unavailable right now. Try again soon.",
          );
        }
        throw err;
      }
      if (!parsed.ok) throw new AppError(422, "rule_not_understood", parsed.error);
      return c.json({ rule: await createRule(db, userId, text, parsed.rule) }, 201);
    },
  );

  r.patch("/rules/:id", async (c) => {
    const { id } = pathParams(c, idParam);
    const { is_active } = await jsonBody(c, z.object({ is_active: z.boolean() }).strict());
    const rule = await setRuleActive(db, c.get("userId"), id, is_active);
    if (!rule) throw notFound("Rule");
    return c.json({ rule });
  });

  r.delete("/rules/:id", async (c) => {
    const { id } = pathParams(c, idParam);
    if (!(await deleteRule(db, c.get("userId"), id))) throw notFound("Rule");
    return c.body(null, 204);
  });

  r.post("/rules/:id/apply", async (c) => {
    const { id } = pathParams(c, idParam);
    const result = await applyRuleRetroactively(db, c.get("userId"), id);
    if (result.status === "not_found") throw notFound("Rule");
    if (result.status === "inactive")
      throw conflict("Turn the rule on before applying it", "rule_inactive");
    return c.json({ matched: result.matched, updated: result.updated });
  });

  return r;
}
