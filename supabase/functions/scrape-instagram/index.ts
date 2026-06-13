// Supabase Edge Function (Deno) — scrapes Instagram reel metadata, geocodes
// location, and classifies category via Claude. Called from the share handler
// immediately after a user shares an Instagram URL.
//
// Provider-agnostic: configure SCRAPING_API_URL + SCRAPING_API_KEY +
// SCRAPING_API_HOST (the RapidAPI x-rapidapi-host value) in Supabase secrets.
// Switch providers by updating those three values alone.

import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SCRAPING_API_KEY = Deno.env.get("SCRAPING_API_KEY") ?? "";
const SCRAPING_API_HOST = Deno.env.get("SCRAPING_API_HOST") ?? "";
const SCRAPING_API_URL = Deno.env.get("SCRAPING_API_URL") ?? "";
// V2 endpoints use "code_or_id_or_url"; V1 used "reel_post_code_or_url". Configurable via secret.
const SCRAPING_API_PARAM = Deno.env.get("SCRAPING_API_PARAM") ?? "code_or_id_or_url";
const GOOGLE_PLACES_KEY =
  Deno.env.get("GOOGLE_PLACES_API_KEY") ??
  Deno.env.get("GOOGLE_GEOCODING_API_KEY") ??
  "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type ScrapeCategory =
  | "places"
  | "recipes"
  | "fashion"
  | "shopping"
  | "watch_learn"
  | "inspo";

interface ScrapeResult {
  caption: string;
  hashtags: string[];
  location_name: string | null;
  location_id: string | null;
  thumbnail_url: string | null;
  owner_username: string | null;
  owner_full_name: string | null;
  owner_profile_pic_url: string | null;
  shortcode: string;
}

interface GeoResult {
  resolved_name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  google_place_id: string;
}

function log(step: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ step, ts: new Date().toISOString(), ...data }));
}

// Handles /reel/ and /p/ URL formats (both are valid Instagram post URLs).
function extractShortcode(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:reel|p)\/([A-Za-z0-9_-]+)/);
  return m?.[1] ?? null;
}

// Normalise response for get_media_data_v2.php (instagram-scraper-stable-api).
// V2 response is flat (no "data" wrapper). Key fields:
//   shortcode, thumbnail_src, display_url, owner.{username,full_name,profile_pic_url},
//   edge_media_to_caption.edges[0].node.text, location.{id,name}
function normalizeScraperResponse(raw: unknown): ScrapeResult | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;

  // V2 is flat; V1 variants nest under "data"/"result"/"media". Fall through to top-level.
  const data = (
    (d.data && typeof d.data === "object" ? d.data : null) ??
    (d.result && typeof d.result === "object" ? d.result : null) ??
    (d.media && typeof d.media === "object" ? d.media : null) ??
    d
  ) as Record<string, unknown>;

  // V2: caption lives in edge_media_to_caption.edges[0].node.text (may be empty array).
  const captionEdges = (
    (data.edge_media_to_caption as Record<string, unknown>)?.edges as Array<Record<string, unknown>>
  ) ?? [];
  const caption =
    (captionEdges[0]?.node as Record<string, unknown>)?.text as string ||
    (data.post_caption as string) ||
    (data.caption_text as string) ||
    (data.caption as string) ||
    "";

  const rawHashtags = data.hashtags as string[] | undefined;
  const hashtags: string[] = Array.isArray(rawHashtags)
    ? rawHashtags
    : (caption.match(/#[\wऀ-ॿ]+/g) ?? []);

  const locationObj = data.location as Record<string, unknown> | null;
  const location_name =
    (locationObj?.name as string) || (data.location_name as string) || null;
  const location_id =
    (locationObj?.id as string) || (data.location_id as string) || null;

  // V2: thumbnail_src is the primary field; fall back to display_url etc.
  const thumbnail_url =
    (data.thumbnail_src as string) ||
    (data.thumbnail_url as string) ||
    (data.display_url as string) ||
    (data.image_url as string) ||
    null;

  const ownerObj = data.owner as Record<string, unknown> | undefined;
  const owner_username =
    (ownerObj?.username as string) || (data.owner_username as string) || (data.username as string) || null;
  const owner_full_name =
    (ownerObj?.full_name as string) || null;
  const owner_profile_pic_url =
    (ownerObj?.profile_pic_url as string) || null;

  const shortcode =
    (data.shortcode as string) ||
    (data.post_short_code as string) ||
    (data.code as string) ||
    "";

  return { caption, hashtags, location_name, location_id, thumbnail_url, owner_username, owner_full_name, owner_profile_pic_url, shortcode };
}

async function callScraper(url: string, shortcode: string): Promise<ScrapeResult | null> {
  if (!SCRAPING_API_URL || !SCRAPING_API_KEY) {
    log("scraper_skip", { reason: "SCRAPING_API_URL or SCRAPING_API_KEY not configured" });
    return null;
  }

  log("scraper_call", { url, shortcode });
  try {
    // V2 endpoints accept shortcode or URL via a configurable param name.
    // Pass shortcode for V2; if shortcode extraction failed somehow, fall back to full URL.
    const paramValue = shortcode || url;
    const endpoint = `${SCRAPING_API_URL}?${SCRAPING_API_PARAM}=${encodeURIComponent(paramValue)}`;
    const headers: Record<string, string> = {
      "x-rapidapi-key": SCRAPING_API_KEY,
      "Content-Type": "application/json",
    };
    if (SCRAPING_API_HOST) headers["x-rapidapi-host"] = SCRAPING_API_HOST;

    const resp = await fetch(endpoint, {
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (resp.status === 403) {
      log("scraper_private", { status: 403 });
      return null;
    }
    if (resp.status === 429) {
      log("scraper_rate_limit", { status: 429 });
      return null;
    }
    if (!resp.ok) {
      log("scraper_error", { status: resp.status });
      return null;
    }

    const raw = await resp.json();
    log("scraper_raw_received", { keys: Object.keys(raw ?? {}), error: (raw as Record<string, unknown>)?.error ?? null, message: (raw as Record<string, unknown>)?.message ?? null });

    // Provider returned an error body — treat as failure.
    if (raw && typeof raw === "object" && ("error" in raw || "message" in raw) && !("caption" in raw) && !("post_caption" in raw) && !("data" in raw)) {
      log("scraper_api_error", { error: (raw as Record<string, unknown>).error, message: (raw as Record<string, unknown>).message });
      return null;
    }

    const result = normalizeScraperResponse(raw);
    if (!result || (!result.caption && !result.thumbnail_url)) {
      log("scraper_empty");
      return null;
    }
    log("scraper_ok", {
      hasCaption: !!result.caption,
      hashtags: result.hashtags.length,
      hasLocation: !!result.location_name,
      hasThumbnail: !!result.thumbnail_url,
    });
    return result;
  } catch (err) {
    const isTimeout =
      err instanceof Error && err.name === "TimeoutError";
    log("scraper_exception", { isTimeout, error: String(err) });
    return null;
  }
}

async function geocodeLocation(locationName: string): Promise<GeoResult | null> {
  if (!GOOGLE_PLACES_KEY) {
    log("geocode_skip", { reason: "GOOGLE_PLACES_KEY not set" });
    return null;
  }
  if (!locationName) {
    log("geocode_skip", { reason: "locationName empty" });
    return null;
  }
  log("geocode_start", { locationName });
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(locationName)}&key=${GOOGLE_PLACES_KEY}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    log("geocode_http", { status: resp.status, ok: resp.ok });
    if (!resp.ok) {
      log("geocode_http_error", { status: resp.status });
      return null;
    }
    const data = await resp.json();
    log("geocode_api_status", { status: data.status, resultCount: data.results?.length ?? 0, errorMessage: data.error_message ?? null });
    if (data.status !== "OK") {
      log("geocode_api_denied", { status: data.status, message: data.error_message ?? "none" });
      return null;
    }
    const result = data.results?.[0];
    if (!result) {
      log("geocode_no_result", { locationName });
      return null;
    }

    const comps: Array<{ types: string[]; long_name: string }> =
      result.address_components ?? [];
    const city =
      comps.find((c) => c.types.includes("locality"))?.long_name ??
      comps.find((c) => c.types.includes("administrative_area_level_2"))?.long_name ??
      "";
    const country =
      comps.find((c) => c.types.includes("country"))?.long_name ?? "";

    const geo: GeoResult = {
      resolved_name: result.formatted_address ?? locationName,
      city,
      country,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      google_place_id: result.place_id ?? "",
    };
    log("geocode_ok", { city: geo.city, country: geo.country, lat: geo.lat, lng: geo.lng, resolved: geo.resolved_name });
    return geo;
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    log("geocode_exception", { isTimeout, error: String(err) });
    return null;
  }
}

async function classifyWithClaude(
  caption: string,
  hashtags: string[],
): Promise<{ category: ScrapeCategory; confidence: number; location_hint: string | null }> {
  const system = `You are a content classification engine for Dibs, an app that helps people act on saved social media content. Classify the given Instagram reel into exactly one of these six categories based on caption and hashtags:

- places: cafés, restaurants, bars, hotels, spas, parks, tourist attractions — places visited for food, drink, or experiences. NOT retail stores.
- recipes: food/drink recipes to cook at home. NOT restaurants or cafés.
- fashion: outfits, clothing, styling, OOTD, accessories, beauty, makeup — AND physical fashion retail (clothing stores, boutiques, shoe stores, accessory shops, concept stores). Clothing store visits → fashion, not places.
- shopping: non-fashion products to buy (gadgets, home goods, tech, "link in bio" for products).
- watch_learn: tutorials, educational content, career advice, skill building.
- inspo: mood boards, aesthetic content, motivational quotes, vibes with no clear action.

KEY RULE: A post about visiting a boutique / clothing store / fashion brand store → "fashion". A post about a café / restaurant → "places".

For "places" AND "fashion": extract the specific venue or store name + city if mentioned (e.g. "Zara Flagship, Mumbai" or "Café de Flore, Paris"). If none is mentioned, use null.

Respond ONLY with a JSON object. No preamble, no explanation.
Format: {"category": "<one of the six>", "confidence": <0.0 to 1.0>, "location_hint": "<store/venue name + city if places or fashion, else null>"}`;

  const userMsg = [
    `Caption: ${caption || "No caption available"}`,
    `Hashtags: ${hashtags.length > 0 ? hashtags.join(", ") : "None"}`,
  ].join("\n");

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system,
      messages: [{ role: "user", content: userMsg }],
    });
    const raw = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";
    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const json = JSON.parse(clean);
    return {
      category: (json.category as ScrapeCategory) ?? "inspo",
      confidence: (json.confidence as number) ?? 0.5,
      location_hint: (json.location_hint as string | null) ?? null,
    };
  } catch {
    return { category: "inspo", confidence: 0.5, location_hint: null };
  }
}

// Fire-and-forget pattern: client creates the save first (instant UX), then calls
// this function with the save_id. We do the slow work (scrape → classify → geocode)
// and UPDATE the save directly in the DB — no client waiting required.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  log("request_received");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ ok: false, reason: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let url: string;
  let saveId: string;
  try {
    const body = await req.json();
    if (!body.url || !body.save_id) throw new Error("missing url or save_id");
    url = body.url as string;
    saveId = body.save_id as string;
  } catch {
    return new Response(
      JSON.stringify({ ok: false, reason: "bad_request" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Verify the save belongs to the calling user.
  const { data: authData } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (!authData.user) {
    return new Response(JSON.stringify({ ok: false, reason: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: existingSave } = await admin
    .from("saves")
    .select("id")
    .eq("id", saveId)
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (!existingSave) {
    return new Response(JSON.stringify({ ok: false, reason: "not_found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Respond immediately — the slow work below runs after the response is sent.
  // (Supabase Edge Functions keep running until the handler returns, but the client
  //  can navigate away as soon as it receives this 202.)
  const earlyResponse = new Response(JSON.stringify({ ok: true }), {
    status: 202,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  const shortcode = extractShortcode(url);
  if (!shortcode) {
    log("shortcode_failed", { url });
    return earlyResponse;
  }
  log("shortcode_extracted", { shortcode });

  // 1. Scrape
  const scrape = await callScraper(url, shortcode);
  if (!scrape) {
    log("scrape_failed_no_update", { saveId });
    return earlyResponse;
  }

  // 2. Classify with Claude
  const { category, confidence, location_hint } = await classifyWithClaude(
    scrape.caption,
    scrape.hashtags,
  );
  log("classified", { category, confidence, location_hint });

  // 3. Geocode — places + fashion stores both get mapped
  const locationName = scrape.location_name || ((category === "places" || category === "fashion") ? location_hint : null);
  const geoResult = locationName ? await geocodeLocation(locationName) : null;

  // 4. Update the save row
  const { error: updateError } = await admin.from("saves").update({
    category,
    category_confidence: confidence,
    caption: scrape.caption || null,
    keywords: scrape.hashtags.length > 0 ? scrape.hashtags : null,
    thumbnail_url: scrape.thumbnail_url || null,
    source_username: scrape.owner_username || null,
    scrape_method: "auto",
    status: "enriched",
  }).eq("id", saveId);
  if (updateError) log("save_update_error", { error: updateError.message, saveId });
  else log("save_updated_ok", { saveId, category });

  // 5. Insert location row
  if (geoResult) {
    const { error: locError } = await admin.from("save_locations").insert({
      save_id: saveId,
      place_name: geoResult.resolved_name,
      lat: geoResult.lat,
      lng: geoResult.lng,
      city: geoResult.city,
      country: geoResult.country,
      google_place_id: geoResult.google_place_id,
    });
    if (locError) log("location_insert_error", { error: locError.message, saveId });
    else log("location_inserted_ok", { saveId, city: geoResult.city, lat: geoResult.lat, lng: geoResult.lng });
  }

  return earlyResponse;
});
