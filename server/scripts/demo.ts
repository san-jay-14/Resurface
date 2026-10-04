/**
 * Local demo: the REAL server (HTTP app, pipeline, scheduler, admin dashboard) on in-memory Postgres,
 * with a stubbed internet and a handful of pre-seeded outcomes. No Neon, no keys, no spend.
 *
 *   npm run demo        then open http://localhost:8787/admin  (token: demo-admin-token-0123456789)
 *
 * In the "Try a URL" tab, reel codes starting "Cafe" resolve as Places and "Recipe" as Recipes.
 */
import { serve } from "@hono/node-server";
import { createApp } from "../src/http/app.ts";
import type { Services } from "../src/http/context.ts";
import { loadConfig } from "../src/config.ts";
import { createPipelineContext } from "../src/pipeline/index.ts";
import { drainOnce } from "../src/pipeline/drain.ts";
import { baseTasks } from "../src/scheduler/tasks.ts";
import { MemoryStore } from "../src/storage/memoryStore.ts";
import { silentLogger } from "../src/logger.ts";
import { createTestDb } from "../test/helpers/testDb.ts";
import { fakeAuth, testResolver } from "../test/helpers/app.ts";
import {
  IG,
  KEYS,
  YT,
  createWorld,
  igMedia,
  makeDueSql,
  shareUrl,
  ytItem,
} from "../test/helpers/world.ts";

const TOKEN = "demo-admin-token-0123456789";
const PORT = 8787;

const world = createWorld();
const baseFetch = world.fetch;
// Make unknown posts "work" in the Try-a-URL tab by synthesising media on demand.
world.fetch = (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  if (url.hostname === "api.hikerapi.com" && url.pathname === "/v2/media/info/by/url") {
    const code = /\/p\/([^/]+)/.exec(url.searchParams.get("url") ?? "")?.[1] ?? "";
    if (!world.ig.has(code)) {
      const caption = code.startsWith("Cafe")
        ? "Weekend brunch at Blue Tokai #cafe"
        : code.startsWith("Recipe")
          ? "Easy ingredients recipe #cooking"
          : "just vibes";
      world.ig.set(code, igMedia(code, caption));
    }
  }
  if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/videos")) {
    for (const id of (url.searchParams.get("id") ?? "").split(",")) {
      if (!world.yt.has(id))
        world.yt.set(
          id,
          ytItem(
            id,
            id.startsWith("cafe") ? "Best cafe in town" : "Quick recipe with 3 ingredients",
            "",
          ),
        );
    }
  }
  return baseFetch(input, init);
};

const db = await createTestDb();
const config = loadConfig({
  NODE_ENV: "development",
  ADMIN_DASHBOARD_TOKEN: TOKEN,
  TICK_SECRET: "demo-tick-secret-0123456789abcdef",
  LOG_LEVEL: "silent",
  ...KEYS,
});
const pipeline = createPipelineContext({
  db,
  config,
  log: silentLogger,
  fetch: world.fetch,
  now: () => new Date(),
  storage: new MemoryStore(),
  resolveDns: testResolver,
});
const services: Services = {
  ...pipeline,
  auth: fakeAuth(db),
  kicker: { kick: () => undefined, stop: () => undefined },
  tasks: baseTasks,
};

// ---- seed ----------------------------------------------------------------------------------
const user = async (label: string) => {
  const r = await db.query<{ id: string }>(
    `insert into "user" (name, email) values ($1, $2) returning id`,
    [label, `${label}@demo.dev`],
  );
  const id = r.rows[0]!.id;
  await db.query("insert into users (id, name, email) values ($1, $2, $3)", [
    id,
    label,
    `${label}@demo.dev`,
  ]);
  return id;
};
const alice = await user("alice");
const bob = await user("bob");

world.ig.set("CafeReel01", igMedia("CafeReel01", "Best filter coffee at Blue Tokai #cafe"));
world.ig.set("EmptyCap001", igMedia("EmptyCap001", null));
world.igComments.set("pk_EmptyCap001", [
  {
    text: "It's called Blue Tokai cafe, Indiranagar 📍",
    comment_like_count: 3,
    user: { pk: "42", username: "creator" },
  },
]);
world.ig.set("EmptyCap002", igMedia("EmptyCap002", null));
world.ig.set("DriftReel001", { status: 200, body: { media_or_ad: { totally: "new shape" } } });
world.ig.set("PrivateReel1", { status: 403, body: null });
world.pages.set("https://food.example/pasta", {
  html: `<html><head><title>Pasta</title><meta property="og:title" content="Weeknight Pasta"><meta property="og:description" content="Easy dinner"><script type="application/ld+json">{"@type":"Recipe"}</script></head></html>`,
});
for (const id of ["cafeshort01", "recipshort1", "cafeshort02", "vagueshort1"]) {
  world.yt.set(
    id,
    ytItem(
      id,
      id.startsWith("cafe")
        ? "Best cafe in town"
        : id.startsWith("recip")
          ? "Quick recipe, 3 ingredients"
          : "a thing",
      "",
    ),
  );
}

await shareUrl(services, alice, IG("CafeReel01"));
await shareUrl(services, alice, IG("EmptyCap001"));
await shareUrl(services, alice, IG("EmptyCap002"));
await shareUrl(services, bob, IG("DriftReel001"));
await shareUrl(services, bob, IG("PrivateReel1"));
await shareUrl(services, alice, "https://food.example/pasta");
for (const id of ["cafeshort01", "recipshort1", "cafeshort02", "vagueshort1"])
  await shareUrl(services, bob, YT(id));
await drainOnce(services);
await shareUrl(services, bob, IG("CafeReel01")); // second user, same reel: a pure cache hit
await drainOnce(services);

// A flaky provider: retries, then dead-letter.
world.ig.set("Flaky0000001", { status: 500, body: null });
await shareUrl(services, alice, IG("Flaky0000001"));
for (let i = 0; i < 5; i++) {
  await drainOnce(services);
  await makeDueSql(db);
  await db.query("update provider_health set open_until = null");
}
// Then the key is revoked: the breaker opens, an alert fires, jobs wait (none are lost).
for (let i = 0; i < 6; i++) {
  world.ig.set(`Revoked${i}Reel`, { status: 401, body: null });
  await shareUrl(services, await user(`user${i}`), IG(`Revoked${i}Reel`));
}
await drainOnce(services);

const app = createApp(services);
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\n  dibs. admin dashboard (DEMO: in-memory data, stubbed providers)\n`);
  console.log(`  open   http://localhost:${PORT}/admin`);
  console.log(`  token  ${TOKEN}\n`);
});
