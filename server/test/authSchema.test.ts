import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { buildAuthOptions, createBetterAuthPort } from "../src/auth/betterAuth.ts";
import { loadConfig } from "../src/config.ts";
import { dbFromPool } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { silentLogger } from "../src/logger.ts";

/**
 * Proves Better Auth's own SQL works against OUR migrations, using the real `pg` driver talking to
 * PGlite over a socket. Covers the path Google/Apple sign-in takes (OAuth user + account creation)
 * and the hook that creates the application profile.
 */
describe("Better Auth on our schema", () => {
  const port = 54_000 + Math.floor(Math.random() * 1000);
  let lite: PGlite;
  let server: PGLiteSocketServer;
  let pool: pg.Pool;

  beforeAll(async () => {
    lite = new PGlite();
    await lite.waitReady;
    server = new PGLiteSocketServer({ db: lite, port, host: "127.0.0.1" });
    await server.start();
    pool = new pg.Pool({
      connectionString: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
      max: 1,
    });
  });

  afterAll(async () => {
    await pool.end();
    await server.stop();
    await lite.close();
  });

  it("creates identity, linked account and application profile", async () => {
    const db = dbFromPool(pool, silentLogger);
    await runMigrations(db, silentLogger);

    const config = loadConfig({
      NODE_ENV: "test",
      BETTER_AUTH_SECRET: "s".repeat(40),
      PUBLIC_URL: "http://localhost:8080",
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      APPLE_CLIENT_ID: "com.example.app",
    });
    const authPort = createBetterAuthPort(config, pool, db, silentLogger);
    expect(authPort.handler).toBeTypeOf("function");

    // Create a user exactly the way Google/Apple sign-in does (identity + linked account).
    const auth = betterAuth(buildAuthOptions(config, pool, db, silentLogger));
    const ctx = await auth.$context;
    const created = await ctx.internalAdapter.createOAuthUser(
      { email: "asha@example.com", name: "Asha", emailVerified: true, image: null },
      { providerId: "google", accountId: "g-123", accessToken: "t", scope: "email profile" },
    );
    const userId = created.user.id;
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);

    // The user.create hook produced the application profile.
    const profile = await db.query<{ name: string; email: string }>(
      "select name, email from users where id = $1",
      [userId],
    );
    expect(profile.rows[0]).toEqual({ name: "Asha", email: "asha@example.com" });

    const account = await db.query<{ providerId: string }>(
      `select "providerId" from account where "userId" = $1`,
      [userId],
    );
    expect(account.rows[0]?.providerId).toBe("google");

    // A real session row can be created and resolved through the library's own SQL.
    const session = await ctx.internalAdapter.createSession(userId, false);
    const found = await ctx.internalAdapter.findSession(session.token);
    expect(found?.user.id).toBe(userId);

    // An unauthenticated session lookup must resolve to null (and exercise the session/user SQL).
    expect(await authPort.getSession(new Headers())).toBeNull();

    // Hit the real handler: the session endpoint answers null for anonymous callers.
    const res = await authPort.handler(new Request("http://localhost:8080/api/auth/get-session"));
    expect(res.status).toBe(200);
  });
});
