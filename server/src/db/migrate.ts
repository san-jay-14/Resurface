import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Db } from "./client.ts";
import type { Logger } from "../logger.ts";

/**
 * Forward-only SQL migrations: `migrations/NNNN_name.sql`, applied in order, each in its own
 * transaction. A transaction-scoped advisory lock serialises concurrent boots (multiple instances
 * or a restart overlap); it works through Neon's pooler, unlike session locks. Applied files are
 * checksummed so an edited migration fails loudly instead of silently diverging.
 */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

const LOCK_KEY = 7272741; // arbitrary, stable

interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(`${dir}${name}`, "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    }),
  );
}

export async function runMigrations(db: Db, log: Logger, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.query(`
    create table if not exists schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`);

  const applied: string[] = [];
  for (const m of await loadMigrations(dir)) {
    const done = await db.tx(async (q) => {
      await q.query("select pg_advisory_xact_lock($1)", [LOCK_KEY]);
      const existing = await q.query<{ checksum: string }>(
        "select checksum from schema_migrations where name = $1",
        [m.name],
      );
      const row = existing.rows[0];
      if (row) {
        if (row.checksum !== m.checksum) {
          throw new Error(
            `Migration ${m.name} was modified after being applied (checksum mismatch)`,
          );
        }
        return false;
      }
      await q.query(m.sql);
      await q.query("insert into schema_migrations (name, checksum) values ($1, $2)", [
        m.name,
        m.checksum,
      ]);
      return true;
    });
    if (done) {
      applied.push(m.name);
      log.info({ migration: m.name }, "migration applied");
    }
  }
  return applied;
}
