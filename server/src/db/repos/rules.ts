import { type ParsedRule, evaluateRule, type RuleTarget } from "../../domain/rules.ts";
import type { Db, Queryable, Row } from "../client.ts";
import { json, one } from "../client.ts";

export interface RuleRow extends Row {
  id: string;
  user_id: string;
  raw_text: string;
  parsed_logic: ParsedRule;
  is_active: boolean;
  priority: number;
  hit_count: number;
  created_at: Date;
  updated_at: Date;
}

const COLS =
  "id, user_id, raw_text, parsed_logic, is_active, priority, hit_count, created_at, updated_at";

export async function listRules(q: Queryable, userId: string): Promise<RuleRow[]> {
  const r = await q.query<RuleRow>(
    `select ${COLS} from user_rules where user_id = $1 order by priority, created_at`,
    [userId],
  );
  return r.rows;
}

export async function countRules(q: Queryable, userId: string): Promise<number> {
  const r = await one<{ n: number }>(
    q,
    "select count(*)::int as n from user_rules where user_id = $1",
    [userId],
  );
  return r?.n ?? 0;
}

export async function createRule(
  q: Queryable,
  userId: string,
  rawText: string,
  parsed: ParsedRule,
): Promise<RuleRow> {
  const r = await one<RuleRow>(
    q,
    `insert into user_rules (user_id, raw_text, parsed_logic) values ($1, $2, $3::jsonb) returning ${COLS}`,
    [userId, rawText, json(parsed)],
  );
  if (!r) throw new Error("insert returned no row");
  return r;
}

export async function setRuleActive(
  q: Queryable,
  userId: string,
  id: string,
  active: boolean,
): Promise<RuleRow | null> {
  return one<RuleRow>(
    q,
    `update user_rules set is_active = $3 where id = $1 and user_id = $2 returning ${COLS}`,
    [id, userId, active],
  );
}

export async function deleteRule(q: Queryable, userId: string, id: string): Promise<boolean> {
  const r = await q.query("delete from user_rules where id = $1 and user_id = $2", [id, userId]);
  return r.rowCount > 0;
}

export type ApplyResult =
  | { status: "ok"; matched: number; updated: number }
  | { status: "not_found" }
  | { status: "inactive" };

const BATCH = 500;

/**
 * Apply one rule to ALL of the user's live saves, in keyset-paginated batches (the legacy version
 * silently stopped at 1000 rows). Only saves whose category actually changes are written, so a re-run
 * is idempotent, and hit_count counts real changes.
 */
export async function applyRuleRetroactively(
  db: Db,
  userId: string,
  ruleId: string,
): Promise<ApplyResult> {
  const rule = await one<RuleRow>(
    db,
    `select ${COLS} from user_rules where id = $1 and user_id = $2`,
    [ruleId, userId],
  );
  if (!rule) return { status: "not_found" };
  if (!rule.is_active) return { status: "inactive" };

  const target = rule.parsed_logic.action.set_category;
  let matched = 0;
  let updated = 0;
  let cursor: { createdAt: Date; id: string } | null = null;

  for (;;) {
    const page: Array<RuleTarget & { id: string; category: string; created_at: Date }> = (
      await db.query<RuleTarget & { id: string; category: string; created_at: Date }>(
        `select id, category, created_at, title, caption, ai_description, note, source_username, source_url, source_platform
           from saves
          where user_id = $1 and archived = false
            ${cursor ? "and (created_at, id) > ($3, $4)" : ""}
          order by created_at, id limit $2`,
        cursor ? [userId, BATCH, cursor.createdAt, cursor.id] : [userId, BATCH],
      )
    ).rows;
    if (page.length === 0) break;

    const hits = page.filter((s) => evaluateRule(s, rule.parsed_logic));
    matched += hits.length;
    const toChange = hits.filter((s) => s.category !== target).map((s) => s.id);
    if (toChange.length) {
      const r = await db.query(
        `update saves set category = $1, last_interacted_at = now()
          where user_id = $2 and id = any($3::uuid[]) and category <> $1`,
        [target, userId, toChange],
      );
      updated += r.rowCount;
    }
    const last = page[page.length - 1];
    if (!last || page.length < BATCH) break;
    cursor = { createdAt: last.created_at, id: last.id };
  }

  if (updated > 0) {
    await db.query("update user_rules set hit_count = hit_count + $2 where id = $1", [
      ruleId,
      updated,
    ]);
  }
  return { status: "ok", matched, updated };
}
