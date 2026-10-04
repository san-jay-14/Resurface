import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { ProviderUnavailable } from "../pipeline/health.ts";
import type { HikerClient } from "../providers/hikerapi.ts";
import { instagramDeviceMeta } from "./instagramDevice.ts";
import { filterComments, parseHashtags, type RawComment } from "./comments.ts";
import {
  AcquireBlocked,
  NotFound,
  type PlatformAdapter,
  ProviderError,
  type PostMeta,
  type RawResult,
  SchemaDrift,
  TooLarge,
  TooLong,
} from "./types.ts";

/**
 * Instagram adapter. Metadata comes only from the paid providers in IG_PROVIDER_ORDER (today just
 * HikerAPI, see providers/hikerapi.ts); there is deliberately no scraper and no Instagram login here.
 * Every provider must return the media payload in the shape normalize() reads (the private-API media
 * object), so adding one is a client in providers/ plus one entry in `known` below.
 */
const HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);
const SHORTCODE = /^[A-Za-z0-9_-]{5,}$/;
const MAX_HOPS = 3;
const CDN_HOST = /(cdninstagram\.com|fbcdn\.net)$/i;

/** Pure path parse: /p/, /reel/, /reels/, /tv/, and /{user}/reel/{code}. */
export function parseInstagramPath(u: URL): string | null {
  const segs = u.pathname.split("/").filter(Boolean);
  // /share/{reel|p}/{token}: the token is an opaque redirect key, not a shortcode.
  if (segs[0] === "share") return null;
  for (let i = 0; i < segs.length - 1; i++) {
    const marker = segs[i] as string;
    const code = segs[i + 1] as string;
    if (["p", "reel", "reels", "tv"].includes(marker) && SHORTCODE.test(code)) {
      // /{user}/reel/{code} has exactly one segment before the type marker.
      if (i <= 1) return code;
    }
  }
  return null;
}

export const igCanonicalUrl = (code: string): string => `https://www.instagram.com/p/${code}/`;

/** Follow /share/... redirects manually: max 3 hops, instagram.com hosts only. */
async function resolveShare(u: URL, doFetch: typeof fetch): Promise<URL | null> {
  let cur = u;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const resp = await doFetch(cur, {
      redirect: "manual",
      method: "GET",
      headers: { "user-agent": "Mozilla/5.0 (compatible; DibsBot/1.0)" },
      signal: AbortSignal.timeout(5000),
    });
    const loc = resp.headers.get("location");
    await resp.body?.cancel();
    if (!loc) return null;
    const next = new URL(loc, cur);
    if (!HOSTS.has(next.hostname.toLowerCase())) return null;
    if (parseInstagramPath(next)) return next;
    cur = next;
  }
  return null;
}

/** Ids arrive as numbers or strings; anything else is not an id. */
function asId(v: unknown): string | undefined {
  return typeof v === "string" || typeof v === "number" ? String(v) : undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

export function createInstagramAdapter(deps: {
  fetch: typeof fetch;
  hiker: HikerClient;
  /** Enabled providers, tried in order. Defaults to ["hikerapi"]; [] disables every provider. */
  providerOrder?: string[];
}): PlatformAdapter {
  const known: Record<string, HikerClient> = { hikerapi: deps.hiker };
  const chain = (deps.providerOrder ?? ["hikerapi"]).flatMap((name) =>
    known[name] ? [{ name, client: known[name] }] : [],
  );

  /**
   * Run `call` against each provider in order. not_found/private are authoritative answers and stop
   * the chain; provider errors and open breakers move on to the next one. Throws the last real error,
   * or ProviderUnavailable when every provider was gated.
   */
  async function viaChain<T>(
    call: (p: { name: string; client: HikerClient }) => Promise<T>,
  ): Promise<T> {
    if (!chain.length) {
      throw new ProviderError("blocked", undefined, undefined, "no Instagram provider enabled");
    }
    let failure: ProviderError | undefined;
    let gated: ProviderUnavailable | undefined;
    for (const p of chain) {
      try {
        return await call(p);
      } catch (e) {
        if (e instanceof ProviderUnavailable) {
          if (!gated || e.until < gated.until) gated = e;
        } else if (e instanceof ProviderError) failure = e;
        else throw e;
      }
    }
    throw failure ?? (gated as ProviderUnavailable);
  }

  return {
    id: "instagram",
    match: (u) => HOSTS.has(u.hostname.toLowerCase()),

    async canonicalize(u) {
      let code = parseInstagramPath(u);
      if (!code && u.pathname.startsWith("/share/")) {
        const resolved = await resolveShare(u, deps.fetch);
        code = resolved ? parseInstagramPath(resolved) : null;
      }
      return code ? { contentId: code, canonicalUrl: igCanonicalUrl(code) } : null;
    },

    fetchMeta: (contentId): Promise<RawResult> =>
      viaChain(async (p) => {
        const r = await p.client.fetchMediaByUrl(igCanonicalUrl(contentId), contentId);
        return r.status === "ok" ? { ...r, provider: p.name } : r;
      }),

    fromDevice: (contentId, raw) => instagramDeviceMeta(contentId, igCanonicalUrl(contentId), raw),

    probes: () =>
      chain.map((p) => ({
        name: p.name,
        fetch: (contentId: string) =>
          p.client.fetchMediaByUrl(igCanonicalUrl(contentId), contentId),
      })),

    normalize(raw, contentId): PostMeta {
      const m = raw.payload as Record<string, unknown>;
      const mediaId = (m.pk ?? m.id) as string | number | undefined;
      const capObj = m.caption as Record<string, unknown> | string | null | undefined;
      const hasCaptionField = "caption_text" in m || "caption" in m;
      if (mediaId === undefined && !hasCaptionField) {
        throw new SchemaDrift("media_info_by_url", "pk|id|caption", raw.payload);
      }
      const caption =
        (m.caption_text as string | undefined) ??
        (typeof capObj === "string" ? capObj : (capObj?.text as string | undefined)) ??
        "";

      const user = m.user as Record<string, unknown> | undefined;
      const loc = m.location as Record<string, unknown> | undefined;
      const imgs = (m.image_versions2 as { candidates?: Array<{ url?: string }> } | undefined)
        ?.candidates;
      const vids = m.video_versions as Array<{ url?: string }> | undefined;
      const mediaType =
        m.media_type === 8
          ? "carousel"
          : m.media_type === 2 || m.product_type === "clips"
            ? "short_video"
            : "image";
      const takenAt = m.taken_at;
      const lat = num(loc?.lat);
      const lng = num(loc?.lng);
      const duration = num(m.video_duration);
      const thumb = (m.thumbnail_url as string | undefined) ?? imgs?.[0]?.url;
      const videoUrl = (m.video_url as string | undefined) ?? vids?.[0]?.url;
      const handle = user?.username as string | undefined;
      const authorId = asId(user?.pk);

      return {
        platform: "instagram",
        contentId,
        canonicalUrl: igCanonicalUrl(contentId),
        ...(caption ? { text: caption } : {}),
        hashtags: parseHashtags(caption),
        ...(user
          ? { author: { ...(handle ? { handle } : {}), ...(authorId ? { id: authorId } : {}) } }
          : {}),
        ...(loc && (loc.name || loc.lat != null)
          ? {
              location: {
                ...(loc.name ? { name: loc.name as string } : {}),
                ...(lat !== undefined ? { lat } : {}),
                ...(lng !== undefined ? { lng } : {}),
              },
            }
          : {}),
        ...(thumb ? { thumbnailUrl: thumb } : {}),
        ...(duration !== undefined ? { durationSec: duration } : {}),
        mediaType,
        ...(typeof takenAt === "number"
          ? { publishedAt: new Date(takenAt * 1000).toISOString() }
          : typeof takenAt === "string"
            ? { publishedAt: takenAt }
            : {}),
        extras: {
          ...(mediaId !== undefined ? { mediaId: String(mediaId) } : {}),
          ...(videoUrl ? { videoUrl } : {}),
        },
      };
    },

    async fetchComments(contentId, meta) {
      const mediaId = meta.extras.mediaId as string | undefined;
      if (!mediaId) return [];
      const rows = await viaChain((p) => p.client.fetchCommentsRaw(mediaId, contentId));
      const raw: RawComment[] = rows.map((r) => {
        const c = r as Record<string, unknown>;
        const cu = c.user as Record<string, unknown> | undefined;
        return {
          text: typeof c.text === "string" ? c.text : "",
          likes: Number(c.comment_like_count ?? c.like_count ?? 0),
          byCreator:
            (asId(cu?.pk) !== undefined && asId(cu?.pk) === meta.author?.id) ||
            (!!cu?.username && cu.username === meta.author?.handle),
          pinned: Boolean(c.is_pinned),
        };
      });
      return filterComments(raw);
    },

    frames: ["video"],

    async acquireVideo(_id, meta, o) {
      const url = meta.extras.videoUrl as string | undefined;
      if (!url) throw new NotFound("no video url");
      const u = new URL(url);
      // Only Instagram/Facebook CDN hosts: the URL came from a provider payload.
      if (!CDN_HOST.test(u.hostname)) throw new AcquireBlocked(`unexpected CDN host ${u.hostname}`);
      const resp = await deps.fetch(u, { signal: AbortSignal.timeout(o.timeoutMs) });
      if (resp.status === 403 || resp.status === 410)
        throw new AcquireBlocked(`http ${resp.status}`);
      if (!resp.ok || !resp.body) throw new NotFound(`http ${resp.status}`);
      const declared = Number(resp.headers.get("content-length") ?? 0);
      if (declared > o.maxBytes) throw new TooLarge(`${declared} bytes`);
      if (meta.durationSec && meta.durationSec > 180) throw new TooLong(`${meta.durationSec}s`);

      const dir = await mkdtemp(join(tmpdir(), "dibs-ig-"));
      const filePath = join(dir, "video.mp4");
      const cleanup = () => rm(dir, { recursive: true, force: true });
      const out = createWriteStream(filePath);
      let written = 0;
      try {
        for await (const chunk of resp.body as unknown as AsyncIterable<Uint8Array>) {
          written += chunk.byteLength;
          if (written > o.maxBytes) throw new TooLarge(`>${o.maxBytes} bytes`);
          if (!out.write(chunk)) await once(out, "drain");
        }
        out.end();
        await once(out, "finish");
      } catch (e) {
        out.destroy();
        await cleanup();
        throw e;
      }
      return { filePath, cleanup };
    },

    policy: {
      provider: chain[0]?.name ?? "none",
      providers: chain.map((p) => p.name),
      metaTtlDays: 30,
      maxRetentionDays: 30,
      negativeTtlHours: 24,
      commentsTtlDays: 7,
      mirrorThumbnails: true,
    },
  };
}
