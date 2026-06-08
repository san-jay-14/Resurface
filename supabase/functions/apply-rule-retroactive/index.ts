import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RuleCondition {
  field: string;
  operator: string;
  value: string | string[];
}

interface ParsedLogic {
  conditions: RuleCondition[];
  condition_logic: "AND" | "OR";
  action: { set_category: string | null };
}

function getFieldValue(save: Record<string, unknown>, field: string): string {
  switch (field) {
    case "caption": return String(save.ai_description ?? save.note ?? "");
    case "username": return String(save.source_url ?? "");
    case "url":      return String(save.source_url ?? "");
    case "platform": return String(save.source_platform ?? "");
    default:         return "";
  }
}

function matchCondition(save: Record<string, unknown>, cond: RuleCondition): boolean {
  const fieldValue = getFieldValue(save, cond.field).toLowerCase();
  switch (cond.operator) {
    case "contains":
      if (Array.isArray(cond.value)) {
        return cond.value.some((v) => fieldValue.includes(String(v).toLowerCase()));
      }
      return fieldValue.includes(String(cond.value).toLowerCase());
    case "equals":
      return fieldValue === String(cond.value).toLowerCase();
    case "is":
      return fieldValue === String(cond.value);
    default:
      return false;
  }
}

function evaluateRule(save: Record<string, unknown>, logic: ParsedLogic): boolean {
  const results = logic.conditions.map((c) => matchCondition(save, c));
  return logic.condition_logic === "AND" ? results.every(Boolean) : results.some(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { rule_id, user_id } = await req.json();

  const { data: rule } = await supabase
    .from("user_rules")
    .select("*")
    .eq("id", rule_id)
    .eq("user_id", user_id)
    .single();

  if (!rule) {
    return new Response(JSON.stringify({ ok: false, error: "Rule not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const logic = rule.parsed_logic as ParsedLogic;
  if (!logic.action.set_category) {
    return new Response(JSON.stringify({ ok: true, updated: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: saves } = await supabase
    .from("saves")
    .select("*")
    .eq("user_id", user_id)
    .eq("archived", false);

  if (!saves || saves.length === 0) {
    return new Response(JSON.stringify({ ok: true, updated: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const matchingIds = saves
    .filter((s) => evaluateRule(s as Record<string, unknown>, logic))
    .map((s) => s.id);

  if (matchingIds.length === 0) {
    return new Response(JSON.stringify({ ok: true, updated: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await supabase
    .from("saves")
    .update({ category: logic.action.set_category })
    .in("id", matchingIds);

  await supabase
    .from("user_rules")
    .update({ hit_count: rule.hit_count + matchingIds.length })
    .eq("id", rule_id);

  return new Response(JSON.stringify({ ok: true, updated: matchingIds.length }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
