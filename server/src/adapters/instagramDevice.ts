import { z } from "zod";
import { parseHashtags } from "./comments.ts";
import type { PostMeta } from "./types.ts";

/**
 * Metadata the phone fetched logged-out from the public post page before sharing. It is UNTRUSTED
 * client input: validated and sanitized here, stored in device_submissions (never post_cache), and
 * only ever used for the submitting user's own save until two distinct users agree on the same hash.
 */
export const MAX_CAPTION = 2200;
const MAX_RAW = 4000;
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const CDN_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;
// Control characters except newline and tab, line/paragraph separators and bidi overrides. Built from code
// point ranges so no invisible character lives in the source.
const CONTROL = new RegExp(
  "[" +
    (
      [
        [0x00, 0x08],
        [0x0b, 0x1f],
        [0x7f, 0x9f],
        [0x2028, 0x2029],
        [0x202a, 0x202e],
        [0x2066, 0x2069],
      ] as const
    )
      .map(([lo, hi]) => `${String.fromCharCode(lo)}-${String.fromCharCode(hi)}`)
      .join("") +
    "]",
  "g",
);

/** Wire shape (snake_case like every other route). Everything optional: it is best effort. */
export const deviceMetaSchema = z
  .object({
    shortcode: z.string().max(64).nullish(),
    caption: z.string().max(20_000).nullish(),
    author_username: z.string().max(100).nullish(),
    thumbnail_url: z.string().max(2048).nullish(),
    raw_description: z.string().max(20_000).nullish(),
  })
  .strip();

export type DeviceMetaInput = z.infer<typeof deviceMetaSchema>;

export interface ValidatedDeviceMeta {
  caption?: string;
  authorUsername?: string;
  thumbnailUrl?: string;
}

const clean = (s: string): string => s.replace(CONTROL, "").trim();

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  // Do not leave half of a surrogate pair at the end.
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/**
 * og:description shape: `1,234 likes, 56 comments - username on October 3, 2026: "caption".`
 * Tolerant on purpose: anything that does not match yields null (the raw text is not trusted as a
 * caption), and the likes/comments prefix may be absent.
 */
const OG_DESC =
  /^(?:[\d.,]+[KkMm]? likes?,\s*)?(?:[\d.,]+[KkMm]? comments?\s*)?-?\s*([A-Za-z0-9._]{1,30}) on [^:"]{3,40}:\s*"([\s\S]*?)"\.?\s*$/;

export function parseOgDescription(raw: string): { author: string; caption: string } | null {
  const m = OG_DESC.exec(clean(raw));
  return m ? { author: m[1] as string, caption: m[2] as string } : null;
}

/** Sanitize an untrusted payload. Null when nothing usable survives (no caption and no author). */
export function validateDeviceMeta(
  input: DeviceMetaInput,
  contentId: string,
): ValidatedDeviceMeta | null {
  // A payload that names a different post is a mismatch (or a forgery): drop it whole.
  if (input.shortcode && input.shortcode !== contentId) return null;

  let caption = input.caption ? clean(input.caption) : "";
  let author = input.author_username?.trim() ?? "";
  if (!HANDLE.test(author)) author = "";

  if (!caption && input.raw_description) {
    const parsed = parseOgDescription(input.raw_description.slice(0, MAX_RAW));
    if (parsed) {
      caption = clean(parsed.caption);
      if (!author) author = parsed.author;
    }
  }
  caption = truncate(caption, MAX_CAPTION);

  let thumbnailUrl: string | undefined;
  if (input.thumbnail_url) {
    try {
      const u = new URL(input.thumbnail_url);
      if (
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        !u.port &&
        CDN_HOST.test(u.hostname)
      ) {
        thumbnailUrl = u.toString();
      }
    } catch {
      /* not a URL: drop it */
    }
  }

  if (!caption && !author) return null;
  return {
    ...(caption ? { caption } : {}),
    ...(author ? { authorUsername: author } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  };
}

export function deviceToPostMeta(
  contentId: string,
  canonicalUrl: string,
  v: ValidatedDeviceMeta,
): PostMeta {
  return {
    platform: "instagram",
    contentId,
    canonicalUrl,
    ...(v.caption ? { text: v.caption } : {}),
    hashtags: parseHashtags(v.caption ?? ""),
    ...(v.authorUsername ? { author: { handle: v.authorUsername } } : {}),
    ...(v.thumbnailUrl ? { thumbnailUrl: v.thumbnailUrl } : {}),
    mediaType: "short_video",
    extras: { source: "device" },
  };
}

/** Untrusted wire payload -> sanitized PostMeta, or null when nothing usable survives. */
export function instagramDeviceMeta(
  contentId: string,
  canonicalUrl: string,
  raw: unknown,
): PostMeta | null {
  const parsed = deviceMetaSchema.safeParse(raw);
  if (!parsed.success) return null;
  const v = validateDeviceMeta(parsed.data, contentId);
  return v ? deviceToPostMeta(contentId, canonicalUrl, v) : null;
}
