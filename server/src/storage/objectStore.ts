import { AwsClient } from "aws4fetch";
import type { Config } from "../config.ts";

/**
 * Object storage behind a tiny interface (S3-compatible; Cloudflare R2 in production). Uploads go
 * through the API so type and size are validated server-side; presigned PUTs cannot enforce a
 * size limit.
 */
export interface ObjectStore {
  put(
    key: string,
    body: Uint8Array,
    contentType: string,
    opts?: { cacheControl?: string },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  /** Delete every object under a prefix (account deletion), optionally sparing one key. Returns the number removed. */
  deletePrefix(prefix: string, opts?: { except?: string }): Promise<number>;
  /** Public URL for an object in the public bucket namespace. */
  publicUrl(key: string): string;
}

export function createR2Store(
  r2: NonNullable<Config["r2"]>,
  doFetch: typeof fetch = fetch,
): ObjectStore {
  const client = new AwsClient({
    accessKeyId: r2.accessKeyId,
    secretAccessKey: r2.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const base = `https://${r2.accountId}.r2.cloudflarestorage.com/${r2.bucket}`;
  const url = (key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;

  async function call(method: string, target: string, init: RequestInit = {}): Promise<Response> {
    const signed = await client.sign(target, { method, ...init });
    return doFetch(signed);
  }

  async function list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const q = new URLSearchParams({
        "list-type": "2",
        prefix,
        ...(token ? { "continuation-token": token } : {}),
      });
      const res = await call("GET", `${base}?${q.toString()}`);
      if (!res.ok) throw new Error(`R2 list failed: ${res.status}`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(decodeXml(m[1] ?? ""));
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? decodeXml(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "")
        : undefined;
    } while (token);
    return keys;
  }

  return {
    async put(key, body, contentType, opts) {
      const res = await call("PUT", url(key), {
        body: Buffer.from(body) as unknown as RequestInit["body"],
        headers: {
          "content-type": contentType,
          ...(opts?.cacheControl ? { "cache-control": opts.cacheControl } : {}),
        },
      });
      if (!res.ok) throw new Error(`R2 put failed: ${res.status}`);
    },
    async delete(key) {
      const res = await call("DELETE", url(key));
      if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed: ${res.status}`);
    },
    async deletePrefix(prefix, opts) {
      const keys = (await list(prefix)).filter((k) => k !== opts?.except);
      for (const k of keys) await this.delete(k);
      return keys.length;
    },
    publicUrl: (key) => `${r2.publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`,
  };
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
