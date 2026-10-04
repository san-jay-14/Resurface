// The adapter contract. Every platform implements PlatformAdapter and returns
// one shared PostMeta; nothing downstream knows which platform it came from.
// Rule: no `if (platform === ...)` outside adapters/. If the pipeline needs a
// platform difference, add a field to `policy` or a method to the interface.

export type Platform = "instagram" | "youtube" | "web";

export interface PostMeta {
  platform: Platform;
  contentId: string;
  canonicalUrl: string;
  title?: string;
  text?: string; // IG caption, YT description, web og:description
  hashtags: string[];
  author?: { handle?: string; id?: string };
  location?: { name?: string; lat?: number; lng?: number };
  thumbnailUrl?: string;
  durationSec?: number;
  mediaType: "short_video" | "image" | "carousel" | "page";
  platformCategory?: string; // e.g. YouTube categoryId, used only as a prior
  publishedAt?: string;
  extras: Record<string, unknown>; // platform-specific (videoUrl, comments, jsonLdTypes)
}

/** `provider` names the source that answered (recorded in post_cache.provider); defaults to policy.provider. */
export type RawResult =
  { status: "ok"; payload: unknown; provider?: string } | { status: "not_found" | "private" };

export type ProviderErrorKind =
  "rate_limited" | "blocked" | "upstream" | "auth" | "budget" | "quota";

export class ProviderError extends Error {
  constructor(
    public kind: ProviderErrorKind,
    public retryAfterMs?: number,
    public httpStatus?: number,
    detail?: string,
  ) {
    super(
      [kind, httpStatus ? `(HTTP ${httpStatus})` : "", detail ? `— ${detail}` : ""]
        .filter(Boolean)
        .join(" "),
    );
    this.name = "ProviderError";
  }
}

export class SchemaDrift extends Error {
  constructor(
    public endpoint: string,
    public missingField: string,
    public raw?: unknown,
  ) {
    super(`schema_drift: ${endpoint} missing ${missingField}`);
    this.name = "SchemaDrift";
  }
}

// Frames-worker acquisition errors (typed so they fall through the ladder).
export class AcquireBlocked extends Error {
  constructor(m = "blocked") {
    super(m);
    this.name = "AcquireBlocked";
  }
}
export class TooLarge extends Error {
  constructor(m = "too large") {
    super(m);
    this.name = "TooLarge";
  }
}
export class TooLong extends Error {
  constructor(m = "too long") {
    super(m);
    this.name = "TooLong";
  }
}
export class NotFound extends Error {
  constructor(m = "not found") {
    super(m);
    this.name = "NotFound";
  }
}

export interface AdapterPolicy {
  provider: string;
  /** Every provider this adapter may call, in order. Defaults to [provider]; [] means none enabled. */
  providers?: string[];
  metaTtlDays: number;
  maxRetentionDays: number;
  negativeTtlHours: number;
  commentsTtlDays: number; // 0 = adapter has no comments
  mirrorThumbnails: boolean; // platform CDN URLs expire; copy to Storage at ingest
}

export interface PlatformAdapter {
  id: Platform;
  match(u: URL): boolean;
  canonicalize(u: URL): Promise<{ contentId: string; canonicalUrl: string } | null>;
  // `hint.sourceUrl` is the URL the user shared. Adapters whose contentId is not
  // reversible (web: SHA-256 of the URL) need it; others ignore it.
  fetchMeta(contentId: string, hint?: { sourceUrl?: string }): Promise<RawResult>; // throws ProviderError
  fetchMetaBatch?(ids: string[]): Promise<Map<string, RawResult>>; // YouTube: up to 50 ids
  normalize(raw: RawResult & { status: "ok" }, contentId: string): PostMeta; // throws SchemaDrift
  fetchComments?(contentId: string, meta: PostMeta): Promise<string[]>; // filtered, no handles
  frames: Array<"video" | "thumbnails">; // ordered fallback list
  acquireVideo?(
    id: string,
    meta: PostMeta,
    o: { maxBytes: number; timeoutMs: number },
  ): Promise<{ filePath: string; cleanup(): Promise<void> }>;
  /**
   * Untrusted metadata the phone fetched itself, validated and sanitized into a PostMeta, or null.
   * Used only for the submitting user's own save until two distinct users agree (pipeline/deviceSubmit.ts).
   */
  fromDevice?(contentId: string, raw: unknown): PostMeta | null;
  /** One probe per provider, so the canary can exercise each independently. Defaults to fetchMeta. */
  probes?(): Array<{ name: string; fetch(contentId: string): Promise<RawResult> }>;
  policy: AdapterPolicy;
}
