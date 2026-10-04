import type { AdapterRegistry } from "../adapters/registry.ts";
import type { Platform, PlatformAdapter } from "../adapters/types.ts";

/**
 * URL canonicalization: share-sheet text in, (platform, contentId, canonicalUrl) out. All platform
 * knowledge lives in the adapters; this only picks one.
 */
export class CanonicalizeError extends Error {
  constructor(
    public reason: "no_url" | "unsupported" | "unresolvable" | "blocked",
    detail?: string,
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "CanonicalizeError";
  }
}

/** Share intents often arrive as "Check this out https://… 🔥". Pull out the URL. */
export function extractUrl(text: string): string | null {
  const m = /https?:\/\/[^\s<>"']+/i.exec(text);
  return m ? m[0].replace(/[).,;!?]+$/, "") : null;
}

export interface Canonical {
  adapter: PlatformAdapter;
  platform: Platform;
  contentId: string;
  canonicalUrl: string;
  sourceUrl: string;
}

export async function canonicalizeUrl(
  registry: AdapterRegistry,
  input: string,
): Promise<Canonical> {
  const raw = extractUrl(input);
  if (!raw) throw new CanonicalizeError("no_url");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new CanonicalizeError("no_url", "unparsable");
  }
  const adapter = registry.pick(u);
  if (!adapter) throw new CanonicalizeError("unsupported", u.protocol);
  let c: { contentId: string; canonicalUrl: string } | null;
  try {
    c = await adapter.canonicalize(u);
  } catch (e) {
    throw new CanonicalizeError("blocked", e instanceof Error ? e.message : String(e));
  }
  if (!c) throw new CanonicalizeError("unresolvable", `${adapter.id} url not recognised`);
  return { adapter, platform: adapter.id, sourceUrl: raw, ...c };
}
