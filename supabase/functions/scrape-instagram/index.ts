// Supabase Edge Function (Deno) — scrapes Instagram reel metadata, geocodes
// location, and classifies category via Claude. Called from the share handler
// immediately after a user shares an Instagram URL.
//
// Provider-agnostic: configure SCRAPING_API_URL + SCRAPING_API_KEY +
// SCRAPING_API_HOST (the RapidAPI x-rapidapi-host value) in Supabase secrets.
// Switch providers by updating those three values alone.

import Anthropic from "npm:@anthropic-ai/sdk";

const SCRAPING_API_KEY = Deno.env.get("SCRAPING_API_KEY") ?? "";
const SCRAPING_API_HOST = Deno.env.get("SCRAPING_API_HOST") ?? "";
const SCRAPING_API_URL = Deno.env.get("SCRAPING_API_URL") ?? "";
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
  shortcode: string;
}

interface GeoResult {
  resolved_name: string;
  city: string;
  lat: number;
  lng: number;
  google_place_id: string;
}

function log(step: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ step, ts: new Date().toISOString(), ...data }));
}

function extractShortcode(url: string): string | null {
  const m = url.match(/instagram\.com\/reel\/([A-Za-z0-9_-]+)/);
  return m?.[1] ?? null;
}

// Normalise response across common RapidAPI Instagram scraper formats.
// Field paths vary by provider — this covers the most common layouts.
// Update the priority order here if you switch providers.
function normalizeScraperResponse(raw: unknown): ScrapeResult | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;

  // Some providers nest data inside a "data" key
  const data = (d.data ?? d.result ?? d.media ?? d) as Record<string, unknown>;
  if (!data || typeof data !== "object") return null;

  const caption =
    (data.caption as string) ??
    ((data.edge_media_to_caption as Record<string, unknown>)
      ?.edges as Array<Record<string, unknown>>)?.[0]?.node?.text as string ??
    (data.description as string) ??
    "";

  // Extract hashtags from the caption if the provider doesn't return them
  const rawHashtags = data.hashtags as string[] | undefined;
  const hashtags: string[] = Array.isArray(rawHashtags)
    ? rawHashtags
    : (caption.match(/#[\wऀ-ॿ]+/g) ?? []);

  const locationObj = (data.location ?? data.coauthor_producers) as
    | Record<string, unknown>
    | null;
  const location_name =
    (locationObj?.name as string) ??
    (data.location_name as string) ??
    null;
  const location_id =
    (locationObj?.id as string) ??
    (data.location_id as string) ??
    null;

  const thumbnail_url =
    (data.thumbnail_url as string) ??
    (data.display_url as string) ??
    (data.image_url as string) ??
    (data.thumbnail as string) ??
    (data.cover_image_url as string) ??
    null;

  const owner =
    (data.owner as Record<string, unknown>) ??
    (data.user as Record<string, unknown>);
  const owner_username =
    (owner?.username as string) ??
    (data.owner_username as string) ??
    (data.username as string) ??
    null;

  const shortcode =
    (data.shortcode as string) ??
    (data.code as string) ??
    (data.id as string) ??
    "";

  return { caption, hashtags, location_name, location_id, thumbnail_url, owner_username, shortcode };
}

async function callScraper(url: string, shortcode: string): Promise<ScrapeResult | null> {
  if (!SCRAPING_API_URL || !SCRAPING_API_KEY) {
    log("scraper_skip", { reason: "SCRAPING_API_URL or SCRAPING_API_KEY not configured" });
    return null;
  }

  log("scraper_call", { url, shortcode });
  try {
    const endpoint = `${SCRAPING_API_URL}?url=${encodeURIComponent(url)}&shortcode=${shortcode}`;
    const headers: Record<string, string> = {
      "x-rapidapi-key": SCRAPING_API_KEY,
      "Content-Type": "application/json",
    };
    if (SCRAPING_API_HOST) headers["x-rapidapi-host"] = SCRAPING_API_HOST;

    const resp = await fetch(endpoint, {
      headers,
      signal: AbortSignal.timeout(5000),
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
    log("scraper_raw_received", { keys: Object.keys(raw ?? {}) });
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
  if (!GOOGLE_PLACES_KEY || !locationName) return null;
  log("geocode_start", { locationName });
  try {
    const resp = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(locationName)}&key=${GOOGLE_PLACES_KEY}`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const result = data.results?.[0];
    if (!result) return null;

    const comps: Array<{ types: string[]; long_name: string }> =
      result.address_components ?? [];
    const city =
      comps.find((c) => c.types.includes("locality"))?.long_name ??
      comps.find((c) => c.types.includes("administrative_area_level_2"))?.long_name ??
      "";

    const geo: GeoResult = {
      resolved_name: result.formatted_address ?? locationName,
      city,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      google_place_id: result.place_id ?? "",
    };
    log("geocode_ok", { city: geo.city, lat: geo.lat, lng: geo.lng });
    return geo;
  } catch (err) {
    log("geocode_exception", { error: String(err) });
    return null;
  }
}

async function classifyWithClaude(
  caption: string,
  hashtags: string[],
): Promise<{ category: ScrapeCategory; confidence: number }> {
  const system = `You are a content classification engine for Dibs, an app that helps people act on saved social media content. Classify the given Instagram reel into exactly one of these six categories based on caption and hashtags:

- places: cafes, restaurants, travel destinations, hidden spots, things to do in a city
- recipes: food recipes, cooking tutorials, ingredient lists, kitchen tips
- fashion: outfits, clothing, styling, OOTD, accessories, beauty
- shopping: products to buy, gadgets, home items, pricing language, "link in bio"
- watch_learn: tutorials, educational content, career advice, skill building, documentaries
- inspo: mood boards, aesthetic content, motivational, quotes, vibes with no clear action

Respond ONLY with a JSON object. No preamble, no explanation.
Format: {"category": "<one of the six>", "confidence": <0.0 to 1.0>}`;

  const userMsg = [
    `Caption: ${caption || "No caption available"}`,
    `Hashtags: ${hashtags.length > 0 ? hashtags.join(", ") : "None"}`,
  ].join("\n");

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      system,
      messages: [{ role: "user", content: userMsg }],
    });
    const raw = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";
    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const json = JSON.parse(clean);
    return {
      category: (json.category as ScrapeCategory) ?? "inspo",
      confidence: (json.confidence as number) ?? 0.5,
    };
  } catch {
    return { category: "inspo", confidence: 0.5 };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  log("request_received");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ success: false, reason: "api_error" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let url: string;
  try {
    const body = await req.json();
    if (!body.url) throw new Error("missing url");
    url = body.url as string;
  } catch {
    return new Response(
      JSON.stringify({ success: false, reason: "api_error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const shortcode = extractShortcode(url);
  if (!shortcode) {
    return new Response(
      JSON.stringify({ success: false, reason: "api_error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  log("shortcode_extracted", { shortcode });

  // 1. Scrape
  const scrape = await callScraper(url, shortcode);
  if (!scrape) {
    return new Response(
      JSON.stringify({ success: false, reason: "scrape_empty" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // 2. Geocode (only if location present)
  const geoResult = scrape.location_name
    ? await geocodeLocation(scrape.location_name)
    : null;

  // 3. Classify with Claude
  const { category, confidence } = await classifyWithClaude(
    scrape.caption,
    scrape.hashtags,
  );
  log("classified", { category, confidence });

  return new Response(
    JSON.stringify({
      success: true,
      data: {
        caption: scrape.caption,
        hashtags: scrape.hashtags,
        thumbnail_url: scrape.thumbnail_url,
        owner_username: scrape.owner_username,
        category,
        category_confidence: confidence,
        location: geoResult
          ? {
              raw_name: scrape.location_name!,
              resolved_name: geoResult.resolved_name,
              city: geoResult.city,
              lat: geoResult.lat,
              lng: geoResult.lng,
              google_place_id: geoResult.google_place_id,
            }
          : null,
      },
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
