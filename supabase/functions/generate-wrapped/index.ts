import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

const WRAPPED_SYSTEM_PROMPT = `You are writing personality cards for a Gen Z content-saving app called Dibs.
The cards are funny, self-aware, slightly roasting, and deeply personal.
Think: Spotify Wrapped meets a friend who knows you too well.

You will receive stats about a user's saves. Write 4 lines of copy for their Wrapped card:
1. A headline stat (the most interesting/funny number)
2. A personality label (funny, specific, self-aware — e.g. "Certified Chronic Saver" or "Aspirational Homebody")
3. A roast line about their most saved category or most ignored save
4. A closing line that feels like a toast

Rules:
- Keep each line under 60 characters
- Use Gen Z tone: casual, dry, a bit absurd, never corporate
- Use emojis sparingly (max 2 total)
- The roast should be affectionate, not mean
- Return ONLY a JSON object with keys: headline, label, roast, closing
- No markdown, no explanation`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { user_id, period_start } = await req.json();
  if (!user_id) {
    return new Response(JSON.stringify({ ok: false, error: "user_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const periodStart = period_start ?? new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  const { data: saves } = await supabase
    .from("saves")
    .select("*")
    .eq("user_id", user_id)
    .gte("created_at", periodStart);

  if (!saves || saves.length < 15) {
    return new Response(
      JSON.stringify({ ok: false, error: "You need a few more saves before your first Wrapped. Keep going 👀" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const categoryMap: Record<string, number> = {};
  const platformMap: Record<string, number> = {};
  let actedOn = 0;

  for (const s of saves) {
    categoryMap[s.category] = (categoryMap[s.category] ?? 0) + 1;
    platformMap[s.source_platform] = (platformMap[s.source_platform] ?? 0) + 1;
    if (s.acted_on) actedOn++;
  }

  const topCategory = Object.entries(categoryMap).sort((a, b) => b[1] - a[1])[0];
  const platforms = Object.entries(platformMap)
    .sort((a, b) => b[1] - a[1])
    .map(([platform, count]) => ({ platform, count }));

  const peakHourMap: Record<number, number> = {};
  for (const s of saves) {
    const h = new Date(s.created_at).getHours();
    peakHourMap[h] = (peakHourMap[h] ?? 0) + 1;
  }
  const peakHour = parseInt(
    Object.entries(peakHourMap).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "20",
  );

  const dormant = saves
    .filter((s) => !s.acted_on)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
  const dormantDays = dormant
    ? Math.floor((Date.now() - new Date(dormant.created_at).getTime()) / 86400000)
    : 0;

  const stats = {
    total: saves.length,
    acted_on: actedOn,
    top_category: topCategory?.[0] ?? "unsorted",
    top_category_count: topCategory?.[1] ?? 0,
    oldest_dormant_caption: dormant?.ai_description ?? dormant?.title ?? null,
    oldest_dormant_days: dormantDays,
    peak_hour: peakHour,
    platforms,
  };

  const statsText = `
Total saves: ${stats.total}
Acted on: ${stats.acted_on} (${Math.round((stats.acted_on / stats.total) * 100)}%)
Top category: ${stats.top_category} (${stats.top_category_count} saves)
Most ignored save: "${stats.oldest_dormant_caption ?? "unknown"}" (saved ${stats.oldest_dormant_days} days ago)
Peak save hour: ${stats.peak_hour}:00
Platforms: ${stats.platforms.map((p) => `${p.platform} (${p.count})`).join(", ")}
  `.trim();

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 400,
    system: WRAPPED_SYSTEM_PROMPT,
    messages: [{ role: "user", content: statsText }],
  });

  const raw = message.content[0].type === "text" ? message.content[0].text : "{}";

  try {
    const copy = JSON.parse(raw);

    await supabase.from("wrapped_history").insert({
      user_id,
      period_start: new Date(periodStart).toISOString().split("T")[0],
      stats_snapshot: stats,
      copy,
    });

    return new Response(JSON.stringify({ ok: true, copy, stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Couldn't generate your card right now. Try again later." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
