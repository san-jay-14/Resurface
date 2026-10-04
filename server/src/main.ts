import { serve } from "@hono/node-server";
import { createBetterAuthPort } from "./auth/betterAuth.ts";
import { systemResolver } from "./adapters/ssrf.ts";
import { loadConfig } from "./config.ts";
import { createPgPool, dbFromPool } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";
import { createApp } from "./http/app.ts";
import type { Services } from "./http/context.ts";
import { createLogger } from "./logger.ts";
import { createPipelineContext } from "./pipeline/index.ts";
import { sweepTemp } from "./pipeline/extract.ts";
import { createDrainKicker } from "./scheduler/kicker.ts";
import { baseTasks } from "./scheduler/tasks.ts";
import { createR2Store } from "./storage/objectStore.ts";

/** Production entry point: the only place that reads the environment and wires dependencies. */
async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config);

  if (!config.db.url) throw new Error("DATABASE_URL is required");

  if (config.db.migrateOnBoot) {
    // Migrations go over the DIRECT connection: they need a plain session, not the transaction pooler.
    const migrationPool = createPgPool({ url: config.db.directUrl ?? config.db.url, max: 1, log });
    try {
      await runMigrations(dbFromPool(migrationPool, log), log);
    } finally {
      await migrationPool.end();
    }
  }

  const pool = createPgPool({ url: config.db.url, max: config.db.poolMax, log });
  const db = dbFromPool(pool, log);

  const pipeline = createPipelineContext({
    db,
    config,
    log,
    fetch: globalThis.fetch,
    now: () => new Date(),
    storage: config.r2 ? createR2Store(config.r2) : null,
    resolveDns: systemResolver,
  });
  const kicker = createDrainKicker(pipeline);
  const services: Services = {
    ...pipeline,
    auth: createBetterAuthPort(config, pool, db, log),
    kicker,
    tasks: baseTasks,
  };
  await sweepTemp(0);

  const app = createApp(services);
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    log.info({ port: info.port, env: config.env }, "server listening");
  });

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "shutting down");
    kicker.stop();
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  // Logger may not exist yet (config failure): write plainly.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
