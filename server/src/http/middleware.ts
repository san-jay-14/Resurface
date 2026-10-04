import { randomUUID } from "node:crypto";
import type { Context, ErrorHandler, MiddlewareHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { verifyShareToken } from "../db/repos/shareTokens.ts";
import { AppError, tooManyRequests, unauthorized } from "../errors.ts";
import type { AppEnv, Services } from "./context.ts";

/** Attach a request id (honouring an inbound one) and a request-scoped logger. */
export function requestContext(svc: Services): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const inbound = c.req.header("x-request-id");
    const requestId = inbound && /^[\w-]{8,64}$/.test(inbound) ? inbound : randomUUID();
    c.set("requestId", requestId);
    c.set("log", svc.log.child({ requestId }));
    c.header("x-request-id", requestId);
    await next();
  };
}

const QUIET_PATHS = new Set(["/healthz"]);

export function accessLog(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = performance.now();
    await next();
    if (QUIET_PATHS.has(c.req.path)) return;
    c.get("log").info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - started),
        ...(c.get("userId") ? { userId: c.get("userId") } : {}),
      },
      "request",
    );
  };
}

export function errorEnvelope(requestId: string, code: string, message: string, details?: unknown) {
  return { error: { code, message, requestId, ...(details === undefined ? {} : { details }) } };
}

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const requestId = c.get("requestId") ?? "unknown";
  if (err instanceof AppError) {
    return c.json(errorEnvelope(requestId, err.code, err.message, err.details), err.status);
  }
  if (err instanceof HTTPException) {
    const status = err.status as 400 | 401 | 403 | 404 | 413 | 415;
    return c.json(errorEnvelope(requestId, "http_error", err.message || "Request failed"), status);
  }
  (c.get("log") ?? console).error({ err, requestId }, "unhandled error");
  return c.json(errorEnvelope(requestId, "internal_error", "Something went wrong"), 500);
};

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) =>
  c.json(errorEnvelope(c.get("requestId") ?? "unknown", "not_found", "Route not found"), 404);

/** Client IP behind a trusted proxy (Render sets x-forwarded-for); a constant in development. */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (!trustProxy) return "local";
  const xff = c.req.header("x-forwarded-for");
  return xff?.split(",")[0]?.trim() || "unknown";
}

/**
 * Fixed-window in-memory rate limiter. Correct for the single-instance deployment this targets;
 * move to a shared store before running more than one replica.
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  key: (c: Context<AppEnv>) => string;
  now?: () => number;
}): MiddlewareHandler<AppEnv> {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const now = opts.now ?? Date.now;
  const sweeper = setInterval(
    () => {
      const t = now();
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    },
    Math.max(opts.windowMs, 10_000),
  );
  sweeper.unref();

  return async (c, next) => {
    const key = opts.key(c);
    const t = now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      hits.set(key, { count: 1, resetAt: t + opts.windowMs });
    } else if (++entry.count > opts.max) {
      c.header("retry-after", String(Math.ceil((entry.resetAt - t) / 1000)));
      throw tooManyRequests();
    }
    await next();
  };
}

/**
 * Require a signed-in user. The session cookie is the normal credential. Routes that opt in with
 * `allowShareToken` additionally accept `Authorization: ShareToken <token>`, the scoped credential
 * used by the Android share worker, which must never reach any other route.
 */
export function authenticate(
  svc: Services,
  opts: { allowShareToken?: boolean } = {},
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const authz = c.req.header("authorization");
    if (opts.allowShareToken && authz?.startsWith("ShareToken ")) {
      const userId = await verifyShareToken(svc.db, authz.slice("ShareToken ".length).trim());
      if (!userId) throw unauthorized("Invalid or revoked share token");
      c.set("userId", userId);
      return next();
    }
    const session = await svc.auth.getSession(c.req.raw.headers);
    if (!session) throw unauthorized();
    c.set("userId", session.id);
    return next();
  };
}
