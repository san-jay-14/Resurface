import type { Queryable } from "../client.ts";

export async function createBugReport(
  q: Queryable,
  userId: string,
  message: string,
  attachmentKeys: string[],
): Promise<string> {
  const r = await q.query<{ id: string }>(
    "insert into bug_reports (user_id, message, attachments) values ($1, $2, $3::text[]) returning id",
    [userId, message, attachmentKeys],
  );
  return r.rows[0]!.id;
}
