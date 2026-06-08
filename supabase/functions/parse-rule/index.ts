import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

const SYSTEM_PROMPT = `You are a rule parser for a content-saving app called Dibs.
The app has exactly six categories: places, recipes, fashion, shopping, watch_learn, inspo.

When a user writes a plain-English rule, convert it to structured JSON matching this schema exactly:
{
  "conditions": [
    {
      "field": "caption | username | url | platform | time_of_day | day_of_week",
      "operator": "contains | equals | matches_regex | before | after | is",
      "value": "<string or array of strings>"
    }
  ],
  "condition_logic": "AND | OR",
  "action": {
    "set_category": "<one of the six categories or null>",
    "set_tags": ["<optional array of strings>"],
    "add_to_board": "<optional board name or null>"
  }
}

Rules:
- condition_logic is AND if all conditions must match, OR if any condition matches
- set_category must be exactly one of: places, recipes, fashion, shopping, watch_learn, inspo, or null
- If you cannot parse the rule into a valid structure, return { "error": "reason" }
- Return ONLY valid JSON. No explanation, no markdown.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { rule_text, user_id } = await req.json();
  if (!rule_text || !user_id) {
    return new Response(JSON.stringify({ ok: false, error: "rule_text and user_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: rule_text }],
  });

  const raw = message.content[0].type === "text" ? message.content[0].text : "";

  try {
    const parsed = JSON.parse(raw);
    if (parsed.error) {
      return new Response(JSON.stringify({ ok: false, error: parsed.error }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabase
      .from("user_rules")
      .insert({ user_id, raw_text: rule_text, parsed_logic: parsed })
      .select()
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, rule: data, parsed_logic: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Parse failed";
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
