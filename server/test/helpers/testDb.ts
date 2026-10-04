import { readFile } from "node:fs/promises";
import { createPgliteDb } from "../../src/dev/pglite.ts";
import type { Db } from "../../src/db/client.ts";
import { runMigrations } from "../../src/db/migrate.ts";
import { silentLogger } from "../../src/logger.ts";

/**
 * Each test gets its own in-memory Postgres cloned from a migrated snapshot built once by
 * globalSetup.ts (path in PGLITE_TEMPLATE). If the snapshot is missing (e.g. a test run outside
 * vitest's global setup) it falls back to running the migrations directly.
 */
let template: Promise<Blob> | null = null;

function loadTemplate(): Promise<Blob> {
  const path = process.env.PGLITE_TEMPLATE;
  if (!path) return Promise.reject(new Error("PGLITE_TEMPLATE is not set"));
  return readFile(path).then((buf) => new Blob([buf]));
}

export async function createTestDb(): Promise<Db> {
  try {
    template ??= loadTemplate();
    return await createPgliteDb({ loadDataDir: await template });
  } catch {
    const db = await createPgliteDb();
    await runMigrations(db, silentLogger);
    return db;
  }
}
