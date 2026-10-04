// YouTube video acquisition — INTENTIONALLY A STUB.
//
// The spec leaves the internals to the owner and does not cover bot-check
// handling. Never use real users' Google accounts or cookies here, and do not add
// cookie / PO-token workarounds (see "Do NOT build"). Datacenter IPs are heavily
// scrutinised by YouTube; expect real failures from a server.
//
// Until an owner fills this in, every call degrades the frames ladder to the
// thumbnails rung (and sets post_cache.frames_retry_after).

import { AcquireBlocked } from "./types.ts";

export function youtubeAcquireVideo(
  _id: string,
  _meta: unknown,
  _o: { maxBytes: number; timeoutMs: number },
): Promise<{ filePath: string; cleanup(): Promise<void> }> {
  return Promise.reject(new AcquireBlocked("youtube video acquisition not implemented"));
}
