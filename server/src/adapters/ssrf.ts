import { resolve4, resolve6 } from "node:dns/promises";

/**
 * SSRF-safe fetching for user-supplied URLs.
 *  - http/https only, no embedded credentials
 *  - resolve DNS first; refuse loopback, private, link-local, CGNAT, multicast
 *  - re-check the resolved address on EVERY redirect hop, max 3 redirects
 *  - 5 s timeout, 1.5 MB body cap, never execute JavaScript
 *
 * Known limit: the runtime's fetch re-resolves the hostname when connecting, so a DNS-rebinding
 * attacker could in theory answer differently the second time. Mitigated by the per-hop check;
 * fully closing it needs pinned-IP connections.
 */
export class SsrfBlocked extends Error {
  constructor(public reason: string) {
    super(`ssrf_blocked: ${reason}`);
    this.name = "SsrfBlocked";
  }
}

function ipv4ToInt(ip: string): number | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isBlockedV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparsable => refuse
  return V4_BLOCKS.some(([base, bits]) => {
    const b = ipv4ToInt(base) as number;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (b & mask) >>> 0;
  });
}

export function isBlockedIp(ip: string): boolean {
  const v =
    ip
      .replace(/^\[|\]$/g, "")
      .toLowerCase()
      .split("%")[0] ?? "";
  if (v.includes(".") && !v.includes(":")) return isBlockedV4(v);
  if (!v.includes(":")) return true;
  if (v === "::" || v === "::1") return true;
  // IPv4-mapped ::ffff:a.b.c.d or ::ffff:aabb:ccdd
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped?.[1]) return isBlockedV4(mapped[1]);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v);
  if (mappedHex?.[1] && mappedHex[2]) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isBlockedV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const first = parseInt(v.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  return false;
}

export type Resolver = (host: string) => Promise<string[]>;

export const systemResolver: Resolver = async (host) => {
  const out: string[] = [];
  for (const lookup of [resolve4, resolve6]) {
    try {
      out.push(...(await lookup(host)));
    } catch {
      /* no records of this type */
    }
  }
  return out;
};

/** Throws SsrfBlocked unless every address the host resolves to is public. */
export async function assertPublicUrl(u: URL, resolve: Resolver): Promise<void> {
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new SsrfBlocked(`scheme ${u.protocol}`);
  }
  if (u.username || u.password) throw new SsrfBlocked("credentials in url");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new SsrfBlocked(`host ${host}`);
  }
  // Literal IPs (including decimal/hex forms normalised by URL()) are checked directly.
  if (/^[\d.]+$/.test(host) || host.includes(":")) {
    if (isBlockedIp(host)) throw new SsrfBlocked(`address ${host}`);
    return;
  }
  const addrs = await resolve(host);
  if (addrs.length === 0) throw new SsrfBlocked(`no dns records for ${host}`);
  for (const a of addrs) if (isBlockedIp(a)) throw new SsrfBlocked(`${host} resolves to ${a}`);
}

export interface SafeFetchOpts {
  resolve: Resolver;
  doFetch: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  status: number;
  finalUrl: URL;
  contentType: string;
  body: string; // truncated at maxBytes
  truncated: boolean;
}

export async function safeFetch(rawUrl: string | URL, o: SafeFetchOpts): Promise<SafeFetchResult> {
  const { timeoutMs = 5000, maxBytes = 1_500_000, maxRedirects = 3, resolve, doFetch } = o;
  const deadline = AbortSignal.timeout(timeoutMs);
  let url = new URL(rawUrl);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(url, resolve);
    const resp = await doFetch(url, {
      redirect: "manual",
      signal: deadline,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; DibsBot/1.0)",
        accept: "text/html,application/xhtml+xml",
        ...o.headers,
      },
    });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      await resp.body?.cancel();
      if (!loc) throw new Error(`redirect without location (${resp.status})`);
      if (hop === maxRedirects) throw new SsrfBlocked("too many redirects");
      url = new URL(loc, url);
      continue;
    }

    const reader = resp.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          chunks.push(value.slice(0, value.byteLength - (total - maxBytes)));
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const buf = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.byteLength;
    }
    return {
      status: resp.status,
      finalUrl: url,
      contentType: resp.headers.get("content-type") ?? "",
      body: new TextDecoder().decode(buf),
      truncated,
    };
  }
  throw new SsrfBlocked("too many redirects");
}
