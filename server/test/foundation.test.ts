import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { loadConfig, ConfigError } from "../src/config.ts";
import { rateLimit } from "../src/http/middleware.ts";
import type { AppEnv } from "../src/http/context.ts";
import { errorHandler } from "../src/http/middleware.ts";
import { createTestApp, type TestApp } from "./helpers/app.ts";

describe("config", () => {
  it("applies defaults and validates numbers", () => {
    const c = loadConfig({ NODE_ENV: "test", CONFIDENCE_THRESHOLD: "0.7" });
    expect(c.pipeline.confidenceThreshold).toBe(0.7);
    expect(c.pipeline.budgets.hikerapi).toBe(5);
    expect(() => loadConfig({ NODE_ENV: "test", PROMPT_VERSION: "abc" })).toThrow(ConfigError);
  });

  it("requires secrets in production and rejects weak ones", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/DATABASE_URL is required/);
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://x",
        BETTER_AUTH_SECRET: "short",
        PUBLIC_URL: "https://api.example.com",
        TICK_SECRET: "t".repeat(24),
      }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("requires R2 settings as a complete set", () => {
    expect(() => loadConfig({ NODE_ENV: "test", R2_BUCKET: "b" })).toThrow(/R2_\* settings/);
  });
});

describe("http foundation", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.db.close();
  });

  it("serves liveness without touching the database", async () => {
    const r = await t.call(null, "GET", "/healthz");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ status: "ok" });
    expect(r.headers.get("x-request-id")).toBeTruthy();
  });

  it("reports readiness when the database answers", async () => {
    expect((await t.call(null, "GET", "/readyz")).status).toBe(200);
  });

  it("returns the JSON error envelope for unknown routes and unauthenticated calls", async () => {
    const nf = await t.call(null, "GET", "/nope");
    expect(nf.status).toBe(404);
    expect(nf.json.error).toMatchObject({ code: "not_found" });
    const unauth = await t.call(null, "GET", "/v1/me");
    expect(unauth.status).toBe(401);
    expect(unauth.json.error).toMatchObject({ code: "unauthorized" });
    expect(unauth.json.error.requestId).toBe(unauth.headers.get("x-request-id"));
  });

  it("sets security headers", async () => {
    const r = await t.call(null, "GET", "/healthz");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("does not leak internals on unexpected errors", async () => {
    const app = new Hono<AppEnv>();
    app.onError(errorHandler);
    app.get("/boom", () => {
      throw new Error("secret stack detail");
    });
    const res = await app.request("/boom");
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(res.status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("secret stack detail");
  });
});

describe("rateLimit", () => {
  it("limits per key and resets after the window", async () => {
    let now = 1_000;
    const app = new Hono<AppEnv>();
    app.onError(errorHandler);
    app.use("*", rateLimit({ windowMs: 1000, max: 2, key: () => "k", now: () => now }));
    app.get("/", (c) => c.text("ok"));
    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/")).status).toBe(200);
    const blocked = await app.request("/");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    now += 1001;
    expect((await app.request("/")).status).toBe(200);
  });
});
