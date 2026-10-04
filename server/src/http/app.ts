import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv, Services } from "./context.ts";
import {
  accessLog,
  authenticate,
  clientIp,
  errorHandler,
  notFoundHandler,
  rateLimit,
  requestContext,
} from "./middleware.ts";
import { adminRoutes } from "./routes/admin.ts";
import { boardRoutes } from "./routes/boards.ts";
import { deviceRoutes } from "./routes/devices.ts";
import { enqueueRoutes } from "./routes/enqueue.ts";
import { healthRoutes } from "./routes/health.ts";
import { internalRoutes } from "./routes/internal.ts";
import { meRoutes } from "./routes/me.ts";
import { ruleRoutes } from "./routes/rules.ts";
import { saveRoutes } from "./routes/saves.ts";
import { subCategoryRoutes } from "./routes/subCategories.ts";
import { uploadRoutes } from "./routes/uploads.ts";
import { wrappedRoutes } from "./routes/wrapped.ts";

/**
 * Compose the HTTP application. Authorization is enforced here and in the repositories (every
 * user-owned query is scoped by the authenticated user id): this replaces Postgres RLS.
 */
export function createApp(svc: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const trustProxy = svc.config.isProduction;

  app.use("*", requestContext(svc));
  app.use("*", secureHeaders());
  app.use("*", accessLog());
  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  app.route("/", healthRoutes(svc));
  app.route("/", internalRoutes(svc));
  app.route("/", adminRoutes(svc));

  // Auth endpoints (Better Auth). Strict per-IP limit: this is the credential-guessing surface.
  app.use(
    "/api/auth/*",
    rateLimit({ windowMs: 60_000, max: 60, key: (c) => `auth:${clientIp(c, trustProxy)}` }),
  );
  app.on(["GET", "POST"], "/api/auth/*", (c) => svc.auth.handler(c.req.raw));

  const v1 = new Hono<AppEnv>();
  // JSON bodies are tiny; only the multipart upload routes may carry images (4 x 5 MB + overhead).
  const jsonLimit: MiddlewareHandler<AppEnv> = bodyLimit({ maxSize: 256 * 1024 });
  const uploadLimit: MiddlewareHandler<AppEnv> = bodyLimit({ maxSize: 22 * 1024 * 1024 });
  const selectLimit: MiddlewareHandler<AppEnv> = (c, next) =>
    c.req.path === "/v1/me/avatar" || c.req.path === "/v1/bug-reports"
      ? uploadLimit(c, next)
      : jsonLimit(c, next);
  v1.use("*", selectLimit);
  v1.use(
    "*",
    rateLimit({ windowMs: 60_000, max: 240, key: (c) => `ip:${clientIp(c, trustProxy)}` }),
  );
  // The enqueue route authenticates itself (session OR share token); everything after is session-only.
  v1.route("/", enqueueRoutes(svc));
  v1.use("*", authenticate(svc));
  v1.route("/me", meRoutes(svc));
  v1.route("/", uploadRoutes(svc));
  v1.route("/", deviceRoutes(svc));
  v1.route("/", saveRoutes(svc));
  v1.route("/", boardRoutes(svc));
  v1.route("/", subCategoryRoutes(svc));
  v1.route("/", ruleRoutes(svc));
  v1.route("/", wrappedRoutes(svc));
  app.route("/v1", v1);

  return app;
}
