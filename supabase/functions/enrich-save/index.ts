// Supabase Edge Function (Deno) — enriches a pending save with metadata,
// Claude classification, geocoding, and a re-hosted thumbnail.
// Spec §3.4: auto path for web and YouTube URL-based saves.

import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const YOUTUBE_API_KEY = Deno.env.get("YOUTUBE_API_KEY") ?? null;
const GOOGLE_GEOCODING_KEY = Deno.env.get("GOOGLE_GEOCODING_API_KEY") ?? null;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Structured logger — every line is a JSON object so Supabase log viewer
// can filter by step. View logs: Dashboard → Edge Functions → enrich-save → Logs
// ---------------------------------------------------------------------------
function log(step: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ step, ts: new Date().toISOString(), ...data }));
}
function logError(step: string, err: unknown, data?: Record<string, unknown>) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ step, error: message, ts: new Date().toISOString(), ...data }));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type SaveCategory =
  | "places" | "recipes" | "fashion" | "shopping"
  | "watch_learn" | "inspo" | "unsorted";

interface OGMeta {
  title?: string;
  description?: string;
  imageUrl?: string;
  tags?: string[];
}

interface ClassifyResult {
  category: SaveCategory;
  confidence: number;
  location_hints: string[];
  keywords: string[];
  description: string;
}

interface GeoResult {
  lat: number; lng: number;
  city: string; country: string; place_id: string;
}

// ---------------------------------------------------------------------------
// Metadata fetchers
// ---------------------------------------------------------------------------
function isYouTube(url: string): boolean {
  return /youtube\.com|youtu\.be/i.test(url);
}

async function fetchYouTubeMeta(url: string): Promise<OGMeta> {
  if (!YOUTUBE_API_KEY) {
    log("youtube_meta_skip", { reason: "YOUTUBE_API_KEY not set" });
    return {};
  }
  const videoId =
    url.match(/[?&]v=([a-zA-Z0-9_-]{11})/)?.[1] ??
    url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/)?.[1] ??
    url.match(/\/shorts\/([a-zA-Z0-9_-]{11})/)?.[1];
  if (!videoId) {
    log("youtube_meta_skip", { reason: "could not extract video ID", url });
    return {};
  }
  log("youtube_meta_fetch", { videoId });
  try {
    const resp = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet&key=${YOUTUBE_API_KEY}`,
    );
    if (!resp.ok) {
      log("youtube_meta_error", { status: resp.status, videoId });
      return {};
    }
    const data = await resp.json();
    const snippet = data.items?.[0]?.snippet;
    if (!snippet) {
      log("youtube_meta_error", { reason: "no snippet in response", videoId });
      return {};
    }
    const result: OGMeta = {
      title: snippet.title,
      description: (snippet.description as string)?.slice(0, 400),
      imageUrl:
        snippet.thumbnails?.high?.url ??
        snippet.thumbnails?.medium?.url ??
        snippet.thumbnails?.default?.url,
      tags: (snippet.tags as string[])?.slice(0, 10) ?? [],
    };
    log("youtube_meta_ok", { title: result.title, hasThumbnail: !!result.imageUrl, tagCount: result.tags?.length });
    return result;
  } catch (err) {
    logError("youtube_meta_exception", err, { videoId });
    return {};
  }
}

function parseOGMeta(html: string): OGMeta {
  const get = (prop: string): string | undefined => {
    for (const pattern of [
      new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${prop}["']`, "i"),
    ]) {
      const m = html.match(pattern);
      if (m?.[1]) return m[1];
    }
    return undefined;
  };
  return {
    title: get("og:title") ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim(),
    description:
      get("og:description") ??
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1],
    imageUrl: get("og:image"),
  };
}

async function fetchWebMeta(url: string): Promise<OGMeta> {
  log("web_meta_fetch", { url });
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ResurfaceBot/1.0)" },
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) {
      log("web_meta_error", { status: resp.status, url });
      return {};
    }
    const html = await resp.text();
    const result = parseOGMeta(html);
    log("web_meta_ok", {
      title: result.title,
      hasDescription: !!result.description,
      hasThumbnail: !!result.imageUrl,
    });
    return result;
  } catch (err) {
    logError("web_meta_exception", err, { url });
    return {};
  }
}

// ---------------------------------------------------------------------------
// Claude classification
// ---------------------------------------------------------------------------
async function classifyWithClaude(url: string, meta: OGMeta): Promise<ClassifyResult> {
  log("claude_classify_start", {
    url,
    hasTitle: !!meta.title,
    hasDescription: !!meta.description,
    tagCount: meta.tags?.length ?? 0,
  });

  const prompt = `You are classifying saved content for a personal curation app.

URL: ${url}
Title: ${meta.title ?? "unknown"}
Description: ${meta.description ?? "none"}${meta.tags?.length ? `\nTags: ${meta.tags.join(", ")}` : ""}

Classify into exactly ONE of these categories:
- places: cafés, restaurants, bars, travel destinations — anything the user visits in person
- recipes: food to cook at home (NOT restaurants or cafés)
- fashion: clothing, outfits, styling, accessories
- shopping: products to buy online
- watch_learn: tutorials, how-tos, video content to consume later
- inspo: mood boards, aesthetic, general inspiration without a clear action

Return only valid JSON (no markdown code fences):
{
  "category": "<one of the above>",
  "confidence": <0.0-1.0>,
  "location_hints": ["<specific place name or address if mentioned, empty array otherwise>"],
  "keywords": ["<3-6 descriptive keywords>"],
  "description": "<one sentence describing what this is>"
}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";
    log("claude_raw_response", { raw });

    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const json = JSON.parse(clean);
    const result: ClassifyResult = {
      category: (json.category as SaveCategory) ?? "unsorted",
      confidence: (json.confidence as number) ?? 0.5,
      location_hints: Array.isArray(json.location_hints) ? json.location_hints : [],
      keywords: Array.isArray(json.keywords) ? json.keywords : [],
      description: (json.description as string) ?? "",
    };
    log("claude_classify_ok", {
      category: result.category,
      confidence: result.confidence,
      locationHints: result.location_hints,
      keywords: result.keywords,
      description: result.description,
    });
    return result;
  } catch (err) {
    logError("claude_classify_error", err);
    return { category: "unsorted", confidence: 0, location_hints: [], keywords: [], description: "" };
  }
}

// ---------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------
async function geocodeHint(hint: string): Promise<GeoResult | null> {
  if (!GOOGLE_GEOCODING_KEY) {
    log("geocode_skip", { reason: "GOOGLE_GEOCODING_API_KEY not set" });
    return null;
  }
  log("geocode_start", { hint });
  try {
    const resp = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(hint)}&key=${GOOGLE_GEOCODING_KEY}`,
    );
    if (!resp.ok) {
      log("geocode_error", { status: resp.status, hint });
      return null;
    }
    const data = await resp.json();
    log("geocode_api_status", { status: data.status, resultCount: data.results?.length ?? 0 });
    const result = data.results?.[0];
    if (!result) {
      log("geocode_no_result", { hint });
      return null;
    }
    const comps: Array<{ types: string[]; long_name: string }> = result.address_components ?? [];
    const geo: GeoResult = {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      city: comps.find((c) => c.types.includes("locality"))?.long_name ?? "",
      country: comps.find((c) => c.types.includes("country"))?.long_name ?? "",
      place_id: result.place_id ?? "",
    };
    log("geocode_ok", { hint, lat: geo.lat, lng: geo.lng, city: geo.city, country: geo.country });
    return geo;
  } catch (err) {
    logError("geocode_exception", err, { hint });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Thumbnail re-hosting
// ---------------------------------------------------------------------------
async function rehostThumbnail(
  admin: ReturnType<typeof createClient>,
  imageUrl: string,
  saveId: string,
): Promise<string | null> {
  log("thumbnail_rehost_start", { imageUrl, saveId });
  try {
    const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) {
      log("thumbnail_fetch_error", { status: resp.status, imageUrl });
      return null;
    }
    const buffer = await resp.arrayBuffer();
    const contentType = resp.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const path = `thumbnails/${saveId}.${ext}`;
    log("thumbnail_uploading", { path, bytes: buffer.byteLength, contentType });

    const { error } = await admin.storage.from("saves").upload(path, buffer, { contentType, upsert: true });
    if (error) {
      log("thumbnail_upload_error", { error: error.message, path });
      return null;
    }
    const { data } = admin.storage.from("saves").getPublicUrl(path);
    log("thumbnail_rehost_ok", { publicUrl: data.publicUrl });
    return data.publicUrl;
  } catch (err) {
    logError("thumbnail_rehost_exception", err, { imageUrl });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startMs = Date.now();
  log("request_received", { method: req.method });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    log("auth_missing");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: { user }, error: authError } = await admin.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authError || !user) {
    log("auth_invalid", { error: authError?.message });
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  log("auth_ok", { userId: user.id });

  let saveId: string;
  try {
    const body = await req.json();
    if (!body.save_id) throw new Error("missing save_id");
    saveId = body.save_id as string;
  } catch (err) {
    logError("body_parse_error", err);
    return new Response(JSON.stringify({ error: "Invalid body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  log("save_id_received", { saveId });

  const { data: save, error: fetchError } = await admin
    .from("saves")
    .select("*")
    .eq("id", saveId)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !save) {
    log("save_not_found", { saveId, error: fetchError?.message });
    return new Response(JSON.stringify({ error: "Save not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  log("save_loaded", { saveId, url: save.source_url, platform: save.source_platform, currentStatus: save.status });

  const url: string = save.source_url;
  if (!url) {
    log("no_url", { saveId });
    return new Response(JSON.stringify({ error: "No URL to enrich" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 1. Fetch metadata
  const platform = isYouTube(url) ? "youtube" : "web";
  log("platform_detected", { platform, url });
  const meta = platform === "youtube" ? await fetchYouTubeMeta(url) : await fetchWebMeta(url);

  // 2. Classify
  const classification = await classifyWithClaude(url, meta);

  // 3. Geocode first location hint
  const geoResult = classification.location_hints[0]
    ? await geocodeHint(classification.location_hints[0])
    : null;
  if (!geoResult && classification.location_hints[0]) {
    log("geocode_failed", { hint: classification.location_hints[0] });
  }

  // 4. Re-host thumbnail
  const thumbnailUrl = meta.imageUrl
    ? await rehostThumbnail(admin, meta.imageUrl, saveId)
    : null;
  if (!thumbnailUrl && meta.imageUrl) {
    log("thumbnail_failed", { imageUrl: meta.imageUrl });
  }

  // 5. Update save
  log("updating_save", {
    saveId,
    category: classification.category,
    hasDescription: !!classification.description,
    keywordCount: classification.keywords.length,
    hasThumbnail: !!thumbnailUrl,
  });
  const { error: updateError } = await admin
    .from("saves")
    .update({
      category: classification.category,
      ai_description: classification.description || null,
      keywords: classification.keywords.length ? classification.keywords : null,
      thumbnail_url: thumbnailUrl,
      status: "enriched",
    })
    .eq("id", saveId);

  if (updateError) {
    logError("save_update_error", updateError, { saveId });
    return new Response(JSON.stringify({ error: "Failed to update save" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  log("save_updated_ok", { saveId });

  // 6. Insert location row
  if (geoResult) {
    const { error: locError } = await admin.from("save_locations").insert({
      save_id: saveId,
      place_name: classification.location_hints[0],
      lat: geoResult.lat,
      lng: geoResult.lng,
      city: geoResult.city,
      country: geoResult.country,
      google_place_id: geoResult.place_id,
    });
    if (locError) {
      log("location_insert_error", { error: locError.message, saveId });
    } else {
      log("location_inserted_ok", { saveId, city: geoResult.city });
    }
  }

  const elapsed = Date.now() - startMs;
  log("enrich_complete", { saveId, elapsedMs: elapsed, category: classification.category });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
