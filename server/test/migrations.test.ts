import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { silentLogger } from "../src/logger.ts";
import { createTestDb } from "./helpers/testDb.ts";

describe("schema migrations", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it("applies every migration to a clean database", async () => {
    const { rows } = await db.query<{ name: string }>(
      "select name from schema_migrations order by name",
    );
    expect(rows.map((r) => r.name)).toEqual([
      "0001_auth.sql",
      "0002_core.sql",
      "0003_pipeline.sql",
      "0004_seed_calendar.sql",
    ]);
  });

  it("is idempotent: re-running applies nothing", async () => {
    expect(await runMigrations(db, silentLogger)).toEqual([]);
  });

  it("seeds the calendar", async () => {
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from calendar_events",
    );
    expect(rows[0]?.n).toBe(20);
  });

  it("enforces one save per (user, platform, content_id)", async () => {
    const u = await db.query<{ id: string }>(
      `insert into "user" (name, email) values ('A','a@x.test') returning id`,
    );
    const userId = u.rows[0]!.id;
    await db.query("insert into users (id, email) values ($1, 'a@x.test')", [userId]);
    const ins = () =>
      db.query(
        "insert into saves (user_id, source_platform, platform, content_id) values ($1,'instagram','instagram','abc')",
        [userId],
      );
    await ins();
    await expect(ins()).rejects.toThrow(/saves_user_platform_content_key/);
    // manual saves (no content_id) never collide
    for (let i = 0; i < 2; i++) {
      await db.query("insert into saves (user_id, source_platform) values ($1,'web')", [userId]);
    }
  });

  it("touches updated_at on update (drives client polling)", async () => {
    const s = await db.query<{ id: string; updated_at: Date }>(
      "select id, updated_at from saves where content_id is null limit 1",
    );
    const row = s.rows[0]!;
    await new Promise((r) => setTimeout(r, 20));
    await db.query("update saves set note = 'x' where id = $1", [row.id]);
    const after = await db.query<{ updated_at: Date }>(
      "select updated_at from saves where id = $1",
      [row.id],
    );
    expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThan(row.updated_at.getTime());
  });

  it("rejects a modified migration (checksum guard)", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = `${await mkdtemp(`${tmpdir()}/mig-`)}/`;
    await writeFile(`${dir}0001_auth.sql`, "select 1;");
    await expect(runMigrations(db, silentLogger, dir)).rejects.toThrow(
      /modified after being applied/,
    );
  });
});
