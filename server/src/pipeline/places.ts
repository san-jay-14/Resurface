import { type PostMeta, ProviderError } from "../adapters/types.ts";
import type { PipelineContext } from "./context.ts";
import type { Spot } from "./classify.ts";

/**
 * Place resolution (Places/Fashion spots). Google Places text search gives a permanent place_id;
 * coordinates may only be cached 30 days, so every spot carries coords_fetched_at and
 * ensureFreshCoords() re-resolves inside that window. Falls back to the Geocoding API when the key
 * is not enabled for Places API (New).
 */
const COORD_TTL_DAYS = 30;
const REFRESH_AT_DAYS = 25;
const PLACES_COST = 0.032; // Text Search (Pro) per call, USD — accounting only
const GEOCODE_COST = 0.005;
const DAY = 86_400_000;

export interface Resolved {
  place_id: string | null;
  lat: number;
  lng: number;
  city: string | null;
  country: string | null;
  name: string | null;
}

interface Comp {
  types?: string[];
  longText?: string;
  long_name?: string;
}
const comp = (cs: Comp[] | undefined, type: string) => cs?.find((c) => c.types?.includes(type));

export interface Places {
  resolvePlace(name: string, city: string | null, contentId?: string): Promise<Resolved | null>;
  shouldResolve(category: string): boolean;
  resolveSpots(
    spots: Spot[],
    meta: PostMeta | null,
    contentId: string,
    onWarn: (msg: string) => void,
  ): Promise<Spot[]>;
  ensureFreshCoords(
    spots: Spot[],
    contentId: string,
    onWarn: (msg: string) => void,
  ): Promise<{ spots: Spot[]; changed: boolean }>;
}

export function createPlaces(
  ctx: Pick<PipelineContext, "config" | "fetch" | "health" | "now">,
): Places {
  const { config, health } = ctx;
  const key = () => config.providers.placesKey;

  async function placesSearch(query: string, contentId?: string): Promise<Resolved | null> {
    return health.callProvider<Resolved | null>(
      {
        provider: "google_places",
        endpoint: "places.searchText",
        ...(contentId ? { contentId } : {}),
      },
      async () => {
        const resp = await ctx.fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": key() ?? "",
            "x-goog-fieldmask":
              "places.id,places.displayName,places.location,places.addressComponents",
          },
          body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
          signal: AbortSignal.timeout(8000),
        });
        if (resp.status === 403 || resp.status === 400) {
          throw new ProviderError(
            "blocked",
            undefined,
            resp.status,
            "places api not enabled for key",
          );
        }
        if (resp.status === 429) throw new ProviderError("rate_limited", undefined, 429);
        if (!resp.ok) throw new ProviderError("upstream", undefined, resp.status);
        const body = (await resp.json()) as {
          places?: Array<{
            id: string;
            displayName?: { text?: string };
            location?: { latitude: number; longitude: number };
            addressComponents?: Comp[];
          }>;
        };
        const p = body.places?.[0];
        if (!p?.location) return { status: 200, value: null, cost: PLACES_COST };
        return {
          status: 200,
          cost: PLACES_COST,
          value: {
            place_id: p.id,
            lat: p.location.latitude,
            lng: p.location.longitude,
            name: p.displayName?.text ?? null,
            city: comp(p.addressComponents, "locality")?.longText ?? null,
            country: comp(p.addressComponents, "country")?.longText ?? null,
          },
        };
      },
    );
  }

  async function geocode(query: string, contentId?: string): Promise<Resolved | null> {
    return health.callProvider<Resolved | null>(
      { provider: "google_places", endpoint: "geocode", ...(contentId ? { contentId } : {}) },
      async () => {
        const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
        url.searchParams.set("address", query);
        url.searchParams.set("key", key() ?? "");
        const resp = await ctx.fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!resp.ok) throw new ProviderError("upstream", undefined, resp.status);
        const body = (await resp.json()) as {
          status: string;
          results?: Array<{
            place_id?: string;
            formatted_address?: string;
            geometry: { location: { lat: number; lng: number } };
            address_components?: Comp[];
          }>;
        };
        if (body.status === "REQUEST_DENIED") {
          throw new ProviderError("auth", undefined, 403, "geocoding denied");
        }
        if (body.status === "OVER_QUERY_LIMIT")
          throw new ProviderError("rate_limited", undefined, 429);
        const r = body.results?.[0];
        if (body.status !== "OK" || !r) return { status: 200, value: null, cost: GEOCODE_COST };
        return {
          status: 200,
          cost: GEOCODE_COST,
          value: {
            place_id: r.place_id ?? null,
            lat: r.geometry.location.lat,
            lng: r.geometry.location.lng,
            name: r.formatted_address ?? null,
            city: comp(r.address_components, "locality")?.long_name ?? null,
            country: comp(r.address_components, "country")?.long_name ?? null,
          },
        };
      },
    );
  }

  async function resolvePlace(name: string, city: string | null, contentId?: string) {
    if (!key()) return null;
    const q = [name, city].filter(Boolean).join(" ");
    try {
      return await placesSearch(q, contentId);
    } catch (e) {
      if (e instanceof ProviderError && e.kind === "blocked") return geocode(q, contentId);
      throw e;
    }
  }

  return {
    resolvePlace,
    shouldResolve: (category) => config.pipeline.placeResolutionCategories.includes(category),

    /** Resolve each named spot; a tagged location with coordinates seeds/backs the first spot. */
    async resolveSpots(spots, meta, contentId, onWarn) {
      const out: Spot[] = spots.map((s) => ({ ...s }));
      const tag = meta?.location;
      if (!out.length && tag?.name) {
        out.push({ name: tag.name, city: null, activity: null, price_hint: null, best_time: null });
      }
      for (const [i, s] of out.entries()) {
        try {
          const r = await resolvePlace(s.name, s.city, contentId);
          if (r) {
            Object.assign(s, {
              place_id: r.place_id,
              lat: r.lat,
              lng: r.lng,
              country: r.country,
              city: s.city ?? r.city,
              resolved_name: r.name,
              coords_fetched_at: ctx.now().toISOString(),
            });
            continue;
          }
        } catch (e) {
          onWarn(`place "${s.name}" not resolved: ${e instanceof Error ? e.message : String(e)}`);
        }
        // Fall back to the platform's own location tag coordinates for the first spot.
        if (i === 0 && tag?.lat != null && tag?.lng != null) {
          Object.assign(s, {
            lat: tag.lat,
            lng: tag.lng,
            coords_fetched_at: ctx.now().toISOString(),
          });
        }
      }
      return out;
    },

    /** Coordinates older than REFRESH_AT_DAYS are re-resolved so we never serve > 30-day-old coords. */
    async ensureFreshCoords(spots, contentId, onWarn) {
      let changed = false;
      const out: Spot[] = [];
      for (const s of spots) {
        const age = s.coords_fetched_at
          ? (ctx.now().getTime() - new Date(s.coords_fetched_at).getTime()) / DAY
          : Number.POSITIVE_INFINITY;
        if (s.lat == null || age < REFRESH_AT_DAYS) {
          out.push(s);
          continue;
        }
        try {
          const r = await resolvePlace(s.name, s.city, contentId);
          if (r) {
            out.push({
              ...s,
              place_id: r.place_id ?? s.place_id ?? null,
              lat: r.lat,
              lng: r.lng,
              coords_fetched_at: ctx.now().toISOString(),
            });
            changed = true;
            continue;
          }
        } catch (e) {
          onWarn(
            `coords refresh failed for "${s.name}": ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        // Past the 30-day cache window and could not refresh: drop the coordinates, keep place_id.
        if (age >= COORD_TTL_DAYS) {
          const { lat: _a, lng: _b, coords_fetched_at: _c, ...rest } = s;
          out.push(rest);
          changed = true;
        } else out.push(s);
      }
      return { spots: out, changed };
    },
  };
}
