import type { Queryable } from "../client.ts";

/** Register (or move) an Expo push token to this user. A token belongs to one device/user at a time. */
export async function upsertDeviceToken(
  q: Queryable,
  userId: string,
  token: string,
  platform: string | null,
): Promise<void> {
  await q.query(
    `insert into device_tokens (user_id, expo_push_token, platform) values ($1, $2, $3)
     on conflict (expo_push_token) do update set user_id = excluded.user_id, platform = excluded.platform`,
    [userId, token, platform],
  );
}

export async function deleteDeviceToken(
  q: Queryable,
  userId: string,
  token: string,
): Promise<void> {
  await q.query("delete from device_tokens where user_id = $1 and expo_push_token = $2", [
    userId,
    token,
  ]);
}

export async function markNotificationTapped(
  q: Queryable,
  userId: string,
  logId: string,
): Promise<boolean> {
  const r = await q.query(
    "update notification_log set tapped = true where id = $1 and user_id = $2",
    [logId, userId],
  );
  return r.rowCount > 0;
}
