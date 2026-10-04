import type { Db } from "../../src/db/client.ts";

export async function makeSave(
  db: Db,
  userId: string,
  over: Record<string, unknown> = {},
): Promise<string> {
  const row = {
    source_platform: "web",
    category: "places",
    ...over,
  };
  const cols = Object.keys(row);
  const r = await db.query<{ id: string }>(
    `insert into saves (user_id, ${cols.join(", ")})
     values ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")}) returning id`,
    [userId, ...Object.values(row)],
  );
  return r.rows[0]!.id;
}

export async function makeLocation(
  db: Db,
  saveId: string,
  over: { place_name?: string; lat?: number | null; lng?: number | null; city?: string } = {},
): Promise<void> {
  await db.query(
    `insert into save_locations (save_id, place_name, lat, lng, city) values ($1, $2, $3, $4, $5)`,
    [
      saveId,
      over.place_name ?? "Blue Tokai",
      "lat" in over ? over.lat : 12.97,
      "lng" in over ? over.lng : 77.64,
      over.city ?? "Bengaluru",
    ],
  );
}
