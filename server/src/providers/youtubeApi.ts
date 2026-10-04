import { ProviderError, type RawResult } from "../adapters/types.ts";
import type { Config } from "../config.ts";
import type { Health } from "../pipeline/health.ts";

/**
 * YouTube Data API v3 client. Server-side key only; never scrape. Quota is ~1 unit per list call
 * against 10,000 units/day for the whole project. On quotaExceeded the breaker opens until the
 * Pacific-midnight reset (handled in health.callProvider) and jobs requeue instead of failing.
 */
export interface YoutubeApiClient {
  videosList(ids: string[]): Promise<Map<string, RawResult>>;
  commentThreads(
    videoId: string,
  ): Promise<Array<{ text: string; likes: number; byCreator: boolean }>>;
}

const PROVIDER = "youtube_data_api";
const BASE = "https://www.googleapis.com/youtube/v3";
const UNITS_PER_CALL = 1;

interface YtError {
  error?: { code?: number; errors?: Array<{ reason?: string }>; message?: string };
}

export function createYoutubeApiClient(deps: {
  config: Config;
  fetch: typeof fetch;
  health: Health;
}): YoutubeApiClient {
  const { config, health } = deps;

  async function get(
    path: string,
    params: Record<string, string>,
  ): Promise<{ status: number; body: unknown }> {
    const key = config.providers.youtubeKey;
    if (!key) throw new ProviderError("auth", undefined, 401, "YOUTUBE_API_KEY not configured");
    const url = new URL(`${BASE}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("key", key);
    const resp = await deps.fetch(url, { signal: AbortSignal.timeout(10_000) });
    let body: unknown = null;
    try {
      body = await resp.json();
    } catch {
      /* ignore */
    }
    return { status: resp.status, body };
  }

  function throwForError(status: number, body: unknown): never {
    const reasons = ((body as YtError | null)?.error?.errors ?? []).map((e) => e.reason);
    if (
      reasons.includes("quotaExceeded") ||
      reasons.includes("dailyLimitExceeded") ||
      reasons.includes("rateLimitExceeded")
    ) {
      throw new ProviderError("quota", undefined, status);
    }
    if (status === 400 && reasons.includes("keyInvalid")) {
      throw new ProviderError("auth", undefined, status, "invalid API key");
    }
    if (status === 401 || status === 403) {
      throw new ProviderError("auth", undefined, status, reasons[0] ?? "forbidden");
    }
    if (status === 429) throw new ProviderError("rate_limited", undefined, status);
    throw new ProviderError("upstream", undefined, status);
  }

  return {
    /** videos.list for up to 50 ids in one call. An id missing from the response is not_found. */
    videosList(ids) {
      if (ids.length === 0) return Promise.resolve(new Map());
      if (ids.length > 50) throw new Error("videosList accepts at most 50 ids");
      return health.callProvider<Map<string, RawResult>>(
        {
          provider: PROVIDER,
          endpoint: "videos.list",
          platform: "youtube",
          contentId: ids.length === 1 ? ids[0] : `batch:${ids.length}`,
        },
        async () => {
          const r = await get("videos", {
            part: "snippet,contentDetails,recordingDetails",
            id: ids.join(","),
            maxResults: "50",
          });
          if (r.status !== 200) throwForError(r.status, r.body);
          const items = (r.body as { items?: Array<{ id: string }> }).items ?? [];
          const out = new Map<string, RawResult>();
          for (const id of ids) {
            const item = items.find((i) => i.id === id);
            out.set(id, item ? { status: "ok", payload: item } : { status: "not_found" });
          }
          return { status: 200, value: out, cost: UNITS_PER_CALL };
        },
      );
    },

    /** commentThreads.list, relevance order. commentsDisabled -> empty list, not an error. */
    commentThreads(videoId) {
      return health.callProvider(
        {
          provider: PROVIDER,
          endpoint: "commentThreads.list",
          platform: "youtube",
          contentId: videoId,
        },
        async () => {
          const r = await get("commentThreads", {
            part: "snippet",
            videoId,
            order: "relevance",
            maxResults: "20",
            textFormat: "plainText",
          });
          if (r.status === 403 || r.status === 404) {
            const reasons = ((r.body as YtError | null)?.error?.errors ?? []).map((e) => e.reason);
            if (reasons.includes("commentsDisabled") || r.status === 404) {
              return { status: r.status, value: [], cost: UNITS_PER_CALL };
            }
          }
          if (r.status !== 200) throwForError(r.status, r.body);
          interface Thread {
            snippet?: {
              channelId?: string;
              topLevelComment?: {
                snippet?: {
                  textDisplay?: string;
                  likeCount?: number;
                  authorChannelId?: { value?: string };
                };
              };
            };
          }
          const items = (r.body as { items?: Thread[] }).items ?? [];
          const value = items.map((t) => {
            const s = t.snippet?.topLevelComment?.snippet;
            return {
              text: s?.textDisplay ?? "",
              likes: s?.likeCount ?? 0,
              byCreator:
                !!s?.authorChannelId?.value && s.authorChannelId.value === t.snippet?.channelId,
            };
          });
          return { status: 200, value, cost: UNITS_PER_CALL };
        },
      );
    },
  };
}
