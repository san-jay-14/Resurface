import { Hono } from "hono";
import type { AppEnv, Services } from "../context.ts";

export function healthRoutes(svc: Services): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // Liveness: never touches the database, so uptime pings keep the web service awake without
  // waking Neon (compute hours are the scarce free-tier resource).
  r.get("/healthz", (c) => c.json({ status: "ok" }));

  // Readiness: verifies the database is reachable (this wakes a suspended Neon compute).
  r.get("/readyz", async (c) => {
    try {
      await Promise.race([
        svc.db.query("select 1"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("db timeout")), 10_000)),
      ]);
      return c.json({ status: "ready" });
    } catch (err) {
      c.get("log").warn({ err }, "readiness check failed");
      return c.json({ status: "unavailable" }, 503);
    }
  });

  return r;
}
