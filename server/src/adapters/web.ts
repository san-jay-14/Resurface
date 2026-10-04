import { sha256Hex } from "../util.ts";
import { assertPublicUrl, type Resolver, safeFetch, SsrfBlocked } from "./ssrf.ts";
import {
  type PlatformAdapter,
  type PostMeta,
  ProviderError,
  type RawResult,
  SchemaDrift,
} from "./types.ts";

/**
 * Generic web adapter. Matches any http(s) URL no other adapter claimed, so it MUST stay last in
 * the registry. The URL is user-supplied, so every fetch goes through safeFetch (SSRF rules). No
 * headless browser: pages that need JS to render fall through to needs_review.
 */
const TRACKING = /^(utm_|fbclid$|gclid$|mc_eid$|mc_cid$|igshid$|ref_src$|_hsenc$|_hsmi$)/i;

export function canonicalWebUrl(u: URL): string {
  const c = new URL(u.toString());
  c.hash = "";
  c.hostname = c.hostname.toLowerCase();
  for (const k of [...c.searchParams.keys()]) if (TRACKING.test(k)) c.searchParams.delete(k);
  c.searchParams.sort();
  if (c.pathname.length > 1 && c.pathname.endsWith("/")) c.pathname = c.pathname.slice(0, -1);
  return c.toString();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function metaTag(html: string, key: string): string | undefined {
  const k = key.replace(/[:.]/g, "\\$&");
  const a = html.match(
    new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, "i"),
  );
  const b = html.match(
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${k}["']`, "i"),
  );
  const v = (a ?? b)?.[1];
  return v ? decodeEntities(v).trim() : undefined;
}

/** Collect JSON-LD @type values (handles arrays, nested @graph). */
export function jsonLdInfo(html: string): { types: string[]; name?: string; description?: string } {
  const types = new Set<string>();
  let name: string | undefined;
  let description: string | undefined;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const t = o["@type"];
    for (const x of Array.isArray(t) ? t : t ? [t] : []) types.add(String(x));
    if (t && typeof o.name === "string") name ??= o.name;
    if (t && typeof o.description === "string") description ??= o.description;
    if (o["@graph"]) visit(o["@graph"]);
  };
  for (const m of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      visit(JSON.parse((m[1] ?? "").trim()));
    } catch {
      /* malformed JSON-LD is common; ignore */
    }
  }
  return { types: [...types], ...(name ? { name } : {}), ...(description ? { description } : {}) };
}

export function createWebAdapter(deps: {
  fetch: typeof fetch;
  resolveDns: Resolver;
}): PlatformAdapter {
  return {
    id: "web",
    match: (u) => u.protocol === "http:" || u.protocol === "https:",

    async canonicalize(u) {
      // Refuse early so a bad URL never creates a save/job for the worker to chew on.
      await assertPublicUrl(u, deps.resolveDns);
      const canonicalUrl = canonicalWebUrl(u);
      return { contentId: sha256Hex(canonicalUrl), canonicalUrl };
    },

    async fetchMeta(contentId, hint): Promise<RawResult> {
      if (!hint?.sourceUrl) {
        throw new ProviderError("upstream", undefined, undefined, "web fetch needs the source url");
      }
      const url = canonicalWebUrl(new URL(hint.sourceUrl));
      if (sha256Hex(url) !== contentId) {
        throw new ProviderError(
          "upstream",
          undefined,
          undefined,
          "source url does not match content id",
        );
      }
      try {
        const r = await safeFetch(url, { resolve: deps.resolveDns, doFetch: deps.fetch });
        if (r.status === 404 || r.status === 410) return { status: "not_found" };
        if (r.status === 401 || r.status === 403) return { status: "private" };
        if (r.status === 429) throw new ProviderError("rate_limited", undefined, 429);
        if (r.status >= 500) throw new ProviderError("upstream", undefined, r.status);
        if (!/html|xml/i.test(r.contentType) && r.contentType !== "")
          return { status: "not_found" };
        return {
          status: "ok",
          payload: {
            html: r.body,
            requestUrl: url,
            finalUrl: r.finalUrl.toString(),
            truncated: r.truncated,
          },
        };
      } catch (e) {
        if (e instanceof SsrfBlocked) return { status: "private" };
        if (e instanceof ProviderError) throw e;
        throw new ProviderError(
          "upstream",
          undefined,
          undefined,
          e instanceof Error ? e.message : String(e),
        );
      }
    },

    normalize(raw, contentId): PostMeta {
      const { html, finalUrl, requestUrl } = raw.payload as {
        html: string;
        finalUrl: string;
        requestUrl?: string;
      };
      if (typeof html !== "string") throw new SchemaDrift("web.fetch", "html", raw.payload);
      const ld = jsonLdInfo(html);
      const title =
        metaTag(html, "og:title") ??
        decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "");
      const text =
        metaTag(html, "og:description") ?? metaTag(html, "description") ?? ld.description;
      const image = metaTag(html, "og:image");
      let thumbnailUrl: string | undefined;
      try {
        thumbnailUrl = image ? new URL(image, finalUrl).toString() : undefined;
      } catch {
        /* bad og:image */
      }
      const finalTitle = title || ld.name;
      return {
        platform: "web",
        contentId,
        canonicalUrl: requestUrl ?? finalUrl,
        ...(finalTitle ? { title: finalTitle } : {}),
        ...(text ? { text } : {}),
        hashtags: [],
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        mediaType: "page",
        extras: { jsonLdTypes: ld.types, finalUrl },
      };
    },

    frames: ["thumbnails"],

    policy: {
      provider: "web",
      metaTtlDays: 7,
      maxRetentionDays: 30,
      negativeTtlHours: 24,
      commentsTtlDays: 0,
      mirrorThumbnails: false,
    },
  };
}
