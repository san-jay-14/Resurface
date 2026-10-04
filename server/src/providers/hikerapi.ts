import { ProviderError, type RawResult } from "../adapters/types.ts";
import type { Config } from "../config.ts";
import type { Health } from "../pipeline/health.ts";
import { sleep } from "../util.ts";

/**
 * HikerAPI client (the only Instagram source). Wrapped so a second provider can be swapped in
 * without touching the pipeline: the Instagram adapter only calls the methods returned here.
 *
 * Status mapping: 404 -> not_found, 403 -> private, 429 -> retry once honouring Retry-After then
 * rate_limited, 5xx/timeouts -> upstream, 401 -> auth, 402 -> budget.
 */
export interface HikerClient {
  fetchMediaByUrl(canonicalUrl: string, contentId: string): Promise<RawResult>;
  fetchCommentsRaw(mediaId: string, contentId: string): Promise<unknown[]>;
}

const PROVIDER = "hikerapi";
const TIMEOUT_MS = 10_000;

interface HttpResult {
  status: number;
  body: unknown;
  retryAfterMs?: number;
}

export function createHikerClient(deps: {
  config: Config;
  fetch: typeof fetch;
  health: Health;
}): HikerClient {
  const { config, health } = deps;
  const cost = () => config.providers.hikerCostPerCall;

  async function http(path: string, params: Record<string, string>): Promise<HttpResult> {
    const key = config.providers.hikerKey;
    if (!key) throw new ProviderError("auth", undefined, 401, "HIKERAPI_KEY not configured");
    const url = new URL(path, config.providers.hikerBase);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const resp = await deps.fetch(url, {
      headers: { "x-access-key": key, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ra = Number(resp.headers.get("retry-after"));
    let body: unknown = null;
    try {
      body = await resp.json();
    } catch {
      /* non-JSON body */
    }
    return {
      status: resp.status,
      body,
      ...(Number.isFinite(ra) && ra > 0 ? { retryAfterMs: ra * 1000 } : {}),
    };
  }

  /** One request with the 429-retry-once rule applied; throws ProviderError for failures. */
  async function request(path: string, params: Record<string, string>): Promise<HttpResult> {
    let r = await http(path, params);
    if (r.status === 429) {
      await sleep(Math.min(r.retryAfterMs ?? 1000, 5000));
      r = await http(path, params);
      if (r.status === 429) throw new ProviderError("rate_limited", r.retryAfterMs, 429);
    }
    if (r.status === 401) throw new ProviderError("auth", undefined, 401);
    if (r.status === 402) throw new ProviderError("budget", undefined, 402);
    if (r.status >= 500) throw new ProviderError("upstream", undefined, r.status);
    return r;
  }

  /** Both shapes seen in the wild: { media_or_ad: {...} } and { items: [...] }. */
  function unwrap(body: unknown): unknown {
    if (!body || typeof body !== "object") return null;
    const b = body as Record<string, unknown>;
    if (b.media_or_ad && typeof b.media_or_ad === "object") return b.media_or_ad;
    if (Array.isArray(b.items) && b.items.length) return b.items[0];
    if (b.pk || b.id || b.code || b.caption || b.caption_text) return b;
    return null;
  }

  return {
    /** Media info by post URL: v2 first, v1 on a 400 or unexpected shape. */
    fetchMediaByUrl: (canonicalUrl, contentId) =>
      health.callProvider<RawResult>(
        { provider: PROVIDER, endpoint: "media_info_by_url", platform: "instagram", contentId },
        async () => {
          const c = cost();
          let r = await request("/v2/media/info/by/url", { url: canonicalUrl });
          if (r.status === 404) return { status: 404, value: { status: "not_found" }, cost: c };
          if (r.status === 403) return { status: 403, value: { status: "private" }, cost: c };
          let media = r.status === 200 ? unwrap(r.body) : null;
          if (media) return { status: 200, value: { status: "ok", payload: media }, cost: c };

          // v1 fallback. A 4xx other than 404/403 or an unusable shape both land here.
          r = await request(config.providers.hikerV1Path, { url: canonicalUrl });
          if (r.status === 404) return { status: 404, value: { status: "not_found" }, cost: c * 2 };
          if (r.status === 403) return { status: 403, value: { status: "private" }, cost: c * 2 };
          media = r.status === 200 ? unwrap(r.body) : null;
          if (!media) {
            throw new ProviderError("upstream", undefined, r.status, "unexpected response shape");
          }
          return { status: r.status, value: { status: "ok", payload: media }, cost: c * 2 };
        },
      ),

    /** Raw comment objects for a media id. Path is configurable (confirm against HikerAPI docs). */
    fetchCommentsRaw: (mediaId, contentId) =>
      health.callProvider<unknown[]>(
        { provider: PROVIDER, endpoint: "media_comments", platform: "instagram", contentId },
        async () => {
          const r = await request(config.providers.hikerCommentsPath, { id: mediaId });
          if (r.status === 404 || r.status === 403)
            return { status: r.status, value: [], cost: cost() };
          if (r.status !== 200) throw new ProviderError("upstream", undefined, r.status);
          const b = r.body as Record<string, unknown> | unknown[] | null;
          const list = Array.isArray(b)
            ? b
            : Array.isArray(b?.comments)
              ? (b.comments as unknown[])
              : Array.isArray(b?.items)
                ? (b.items as unknown[])
                : [];
          return { status: 200, value: list, cost: cost() };
        },
      ),
  };
}
