import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { invite_code, user_id } = await req.json();
  if (!invite_code || !user_id) {
    return new Response(JSON.stringify({ ok: false, error: "invite_code and user_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: board } = await supabase
    .from("collections")
    .select("id, name, owner_id, is_shared")
    .eq("invite_code", invite_code.toUpperCase())
    .single();

  if (!board || !board.is_shared) {
    return new Response(
      JSON.stringify({ ok: false, error: "That code doesn't look right. Check with whoever sent it." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { data: existing } = await supabase
    .from("collection_members")
    .select("id")
    .eq("collection_id", board.id)
    .eq("user_id", user_id)
    .single();

  if (existing) {
    return new Response(
      JSON.stringify({ ok: false, error: "You're already in this board." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { error } = await supabase.from("collection_members").insert({
    collection_id: board.id,
    user_id,
    role: "member",
  });

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: memberCount } = await supabase
    .from("collection_saves")
    .select("save_id", { count: "exact", head: true })
    .eq("collection_id", board.id);

  return new Response(
    JSON.stringify({ ok: true, board: { ...board, save_count: memberCount ?? 0 } }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
