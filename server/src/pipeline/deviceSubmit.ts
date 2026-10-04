import type { AdapterRegistry } from "../adapters/registry.ts";
import type { PostMeta } from "../adapters/types.ts";
import type { Db } from "../db/client.ts";
import {
  countConfirmations,
  insertSubmission,
  promoteToPostCache,
} from "../db/repos/deviceMeta.ts";
import { addDays } from "./cache.ts";
import { sha256Hex } from "../util.ts";

/** Corroborated device metadata is soft-cached shorter than provider data. */
const DEVICE_TTL_DAYS = 7;
const RETENTION_DAYS = 30;
/** Distinct users that must submit the same content hash before it is served to anyone else. */
export const CORROBORATION = 2;

/** Hash of the normalized content: two devices that saw the same page produce the same hash. */
export const deviceContentHash = (m: PostMeta): string =>
  sha256Hex(
    `${(m.text ?? "").replace(/\s+/g, " ").trim()}
${(m.author?.handle ?? "").toLowerCase()}`,
  );

export type SubmitResult =
  | { stored: false; reason: "invalid" }
  | { stored: true; confirmations: number; corroborated: boolean };

/**
 * Validate, store and (when two distinct users agree) promote a device payload. Best effort by
 * design: callers swallow failures, since a save must never depend on device metadata.
 */
export async function submitDeviceMeta(
  db: Db,
  registry: AdapterRegistry,
  userId: string,
  platform: string,
  contentId: string,
  raw: unknown,
  now: Date,
): Promise<SubmitResult> {
  const meta = registry.byId(platform).fromDevice?.(contentId, raw) ?? null;
  if (!meta) return { stored: false, reason: "invalid" };
  const contentHash = deviceContentHash(meta);
  await insertSubmission(db, { userId, platform, contentId, contentHash, meta });

  const confirmations = await countConfirmations(db, platform, contentId, contentHash);
  let corroborated = false;
  if (confirmations >= CORROBORATION) {
    corroborated = await promoteToPostCache(db, {
      platform,
      contentId,
      meta,
      contentHash,
      expiresAt: addDays(now, DEVICE_TTL_DAYS),
      purgeAfter: addDays(now, RETENTION_DAYS),
    });
  }
  return { stored: true, confirmations, corroborated };
}
