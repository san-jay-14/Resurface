import { createHash, randomBytes } from "node:crypto";
import type { Queryable } from "../client.ts";
import { one } from "../client.ts";

const MAX_ACTIVE_PER_USER = 10;
const TOUCH_INTERVAL = "1 hour";

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/**
 * Mint a share token for the native Android share worker. The plaintext is returned exactly once;
 * only its SHA-256 is stored. Oldest tokens beyond the per-user cap are revoked.
 */
export async function mintShareToken(
  q: Queryable,
  userId: string,
  label: string | null,
): Promise<string> {
  const token = `dst_${randomBytes(32).toString("base64url")}`;
  await q.query("insert into share_tokens (user_id, token_hash, label) values ($1, $2, $3)", [
    userId,
    hashToken(token),
    label,
  ]);
  await q.query(
    `update share_tokens set revoked_at = now()
      where user_id = $1 and revoked_at is null
        and id not in (select id from share_tokens where user_id = $1 and revoked_at is null
                       order by created_at desc limit $2)`,
    [userId, MAX_ACTIVE_PER_USER],
  );
  return token;
}

/** Resolve a presented token to its user id, or null if unknown/revoked. */
export async function verifyShareToken(q: Queryable, token: string): Promise<string | null> {
  const row = await one<{ user_id: string }>(
    q,
    `update share_tokens
        set last_used_at = case when last_used_at is null or last_used_at < now() - interval '${TOUCH_INTERVAL}'
                                then now() else last_used_at end
      where token_hash = $1 and revoked_at is null
      returning user_id`,
    [hashToken(token)],
  );
  return row?.user_id ?? null;
}

export async function revokeShareTokens(q: Queryable, userId: string): Promise<number> {
  const r = await q.query(
    "update share_tokens set revoked_at = now() where user_id = $1 and revoked_at is null",
    [userId],
  );
  return r.rowCount;
}
