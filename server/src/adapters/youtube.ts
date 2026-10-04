import type { YoutubeApiClient } from "../providers/youtubeApi.ts";
import { filterComments, parseHashtags } from "./comments.ts";
import { type PlatformAdapter, type PostMeta, type RawResult, SchemaDrift } from "./types.ts";
import { youtubeAcquireVideo } from "./youtubeAcquire.ts";

/**
 * YouTube adapter (Data API v3). Everything stored from the API is subject to the 30-day limit:
 * policy.maxRetentionDays = 30 and the daily refresh job.
 */
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const ID = /^[A-Za-z0-9_-]{11}$/;

export function parseYoutubeId(u: URL): string | null {
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split("/").filter(Boolean);
  let id: string | undefined;
  if (host === "youtu.be") id = segs[0];
  else if (segs[0] === "shorts" || segs[0] === "embed" || segs[0] === "live") id = segs[1];
  else if (segs[0] === "watch") id = u.searchParams.get("v") ?? undefined;
  return id && ID.test(id) ? id : null;
}

/** ISO 8601 duration (PT1M5S, P0D, PT45S) -> seconds. */
export function parseIsoDuration(iso: string | undefined): number | undefined {
  const m = iso?.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return undefined;
  const [d = 0, h = 0, mi = 0, s = 0] = m.slice(1).map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

type Thumbs = Record<string, { url?: string; width?: number }>;

/** Best available resolution first. */
export function bestThumbnails(t: Thumbs | undefined): string[] {
  const order = ["maxres", "standard", "high", "medium", "default"];
  return order.map((k) => t?.[k]?.url).filter((x): x is string => !!x);
}

interface VideoItem {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    tags?: string[];
    categoryId?: string;
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: Thumbs;
  };
  contentDetails?: { duration?: string };
  recordingDetails?: {
    location?: { latitude?: number; longitude?: number };
    locationDescription?: string;
  };
}

export function createYoutubeAdapter(deps: { youtube: YoutubeApiClient }): PlatformAdapter {
  return {
    id: "youtube",
    match: (u) => HOSTS.has(u.hostname.toLowerCase()),

    canonicalize(u) {
      const id = parseYoutubeId(u);
      return Promise.resolve(
        id ? { contentId: id, canonicalUrl: `https://www.youtube.com/shorts/${id}` } : null,
      );
    },

    async fetchMeta(contentId): Promise<RawResult> {
      return (await deps.youtube.videosList([contentId])).get(contentId) ?? { status: "not_found" };
    },

    fetchMetaBatch: (ids) => deps.youtube.videosList(ids),

    normalize(raw, contentId): PostMeta {
      const item = raw.payload as VideoItem;
      const s = item.snippet;
      if (!item.id || !s || s.title === undefined) {
        throw new SchemaDrift("videos.list", "snippet.title", raw.payload);
      }
      const loc = item.recordingDetails?.location;
      const locDesc = item.recordingDetails?.locationDescription;
      const thumbs = bestThumbnails(s.thumbnails);
      const duration = parseIsoDuration(item.contentDetails?.duration);
      return {
        platform: "youtube",
        contentId,
        canonicalUrl: `https://www.youtube.com/shorts/${contentId}`,
        title: s.title,
        ...(s.description ? { text: s.description } : {}),
        hashtags: [
          ...new Set([
            ...parseHashtags(s.description, s.title),
            ...(s.tags ?? []).map((t) => t.toLowerCase().replace(/\s+/g, "")),
          ]),
        ].slice(0, 30),
        author: {
          ...(s.channelTitle ? { handle: s.channelTitle } : {}),
          ...(s.channelId ? { id: s.channelId } : {}),
        },
        ...(loc || locDesc
          ? {
              location: {
                ...(locDesc ? { name: locDesc } : {}),
                ...(loc?.latitude !== undefined ? { lat: loc.latitude } : {}),
                ...(loc?.longitude !== undefined ? { lng: loc.longitude } : {}),
              },
            }
          : {}),
        ...(thumbs[0] ? { thumbnailUrl: thumbs[0] } : {}),
        ...(duration !== undefined ? { durationSec: duration } : {}),
        mediaType: "short_video",
        ...(s.categoryId ? { platformCategory: s.categoryId } : {}),
        ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}),
        extras: { thumbnailCandidates: thumbs },
      };
    },

    async fetchComments(contentId) {
      return filterComments(await deps.youtube.commentThreads(contentId));
    },

    frames: ["video", "thumbnails"],
    acquireVideo: youtubeAcquireVideo,

    policy: {
      provider: "youtube_data_api",
      metaTtlDays: 30,
      maxRetentionDays: 30,
      negativeTtlHours: 24,
      commentsTtlDays: 7,
      mirrorThumbnails: false,
    },
  };
}
