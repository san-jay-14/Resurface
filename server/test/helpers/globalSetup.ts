import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPgliteDb } from "../../src/dev/pglite.ts";
import { runMigrations } from "../../src/db/migrate.ts";
import { silentLogger } from "../../src/logger.ts";

/**
 * Build the migrated database snapshot ONCE for the whole run and hand its path to every worker via
 * the environment. Workers then clone it (milliseconds) instead of each booting Postgres and re-running
 * every migration, which starved the CPU when many test files started together.
 */
export async function setup(): Promise<void> {
  const base = await createPgliteDb();
  await runMigrations(base, silentLogger);
  const dump = await base.dump();
  await base.close();
  const dir = await mkdtemp(join(tmpdir(), "resurface-pglite-"));
  const path = join(dir, "template.tar");
  await writeFile(path, Buffer.from(await dump.arrayBuffer()));
  process.env.PGLITE_TEMPLATE = path;
}
