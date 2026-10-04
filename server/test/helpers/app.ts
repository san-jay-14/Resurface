import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type { AuthPort } from "../../src/auth/port.ts";
import { loadConfig } from "../../src/config.ts";
import { createPipelineContext } from "../../src/pipeline/index.ts";
import type { Resolver } from "../../src/adapters/ssrf.ts";
import type { Db } from "../../src/db/client.ts";
import { ensureProfile } from "../../src/db/repos/users.ts";
import { createApp } from "../../src/http/app.ts";
import type { AppEnv, Services } from "../../src/http/context.ts";
import { silentLogger } from "../../src/logger.ts";
import { baseTasks } from "../../src/scheduler/tasks.ts";
import { MemoryStore } from "../../src/storage/memoryStore.ts";
import { createTestDb } from "./testDb.ts";

/** Header-driven fake: `x-test-user: <uuid>` signs the request in as that user. */
export function fakeAuth(db: Db): AuthPort {
  return {
    handler: () => Promise.resolve(new Response("auth", { status: 200 })),
    async getSession(headers) {
      const id = headers.get("x-test-user");
      if (!id) return null;
      const r = await db.query<{ email: string; name: string }>(
        `select email, name from "user" where id = $1`,
        [id],
      );
      const row = r.rows[0];
      return row ? { id, email: row.email, name: row.name } : null;
    },
  };
}

// Test responses are dynamically shaped JSON; tests assert on them directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export interface TestApp {
  app: Hono<AppEnv>;
  db: Db;
  svc: Services;
  store: MemoryStore;
  /** How many times the in-process drain trigger fired (enqueue of a new save). */
  kicks: { count: number };
  /** Create an identity + profile; returns the user id. */
  makeUser(label?: string): Promise<string>;
  /** Issue a request as `userId` (or anonymously when null). */
  call(
    userId: string | null,
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<{ status: number; json: Json; headers: Headers }>;
}

export interface TestAppOptions {
  env?: Record<string, string>;
  fetch?: typeof fetch;
  resolveDns?: Resolver;
  now?: () => Date;
  /** Pass null to run without object storage configured. */
  storage?: null;
}

/** Public-looking addresses for any *.example host; everything else resolves to a private address. */
export const testResolver: Resolver = (host) =>
  Promise.resolve(host.endsWith(".example") ? ["93.184.216.34"] : ["10.0.0.9"]);

export async function createTestApp(opts: TestAppOptions = {}): Promise<TestApp> {
  const db = await createTestDb();
  const store = new MemoryStore();
  const kicks = { count: 0 };
  const pipeline = createPipelineContext({
    db,
    config: loadConfig({ NODE_ENV: "test", ...opts.env }),
    log: silentLogger,
    fetch: opts.fetch ?? (() => Promise.reject(new Error("unexpected network call in test"))),
    now: opts.now ?? (() => new Date()),
    storage: opts.storage === null ? null : store,
    resolveDns: opts.resolveDns ?? testResolver,
  });
  const svc: Services = {
    ...pipeline,
    auth: fakeAuth(db),
    kicker: { kick: () => void kicks.count++, stop: () => undefined },
    tasks: baseTasks,
  };
  const app = createApp(svc);

  const makeUser = async (label = "user") => {
    const id = randomUUID();
    await db.query(`insert into "user" (id, name, email) values ($1, $2, $3)`, [
      id,
      label,
      `${label}-${id}@test.dev`,
    ]);
    await ensureProfile(db, id);
    return id;
  };

  const call: TestApp["call"] = async (userId, method, path, body, headers = {}) => {
    const res = await app.request(path, {
      method,
      headers: {
        ...(userId ? { "x-test-user": userId } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  };

  return { app, db, svc, store, kicks, makeUser, call };
}
