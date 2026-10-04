/**
 * Typed application errors. Route handlers throw these; the error middleware maps
 * them to the JSON envelope `{ error: { code, message, requestId } }`. Anything
 * else is logged and reported as an opaque 500 so internals never leak.
 */
export class AppError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 502 | 503,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "Authentication required") =>
  new AppError(401, "unauthorized", message);
export const forbidden = (message = "You do not have access to this resource") =>
  new AppError(403, "forbidden", message);
export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found`);
export const conflict = (message: string, code = "conflict") => new AppError(409, code, message);
export const unprocessable = (message: string, details?: unknown) =>
  new AppError(422, "unprocessable", message, details);
export const tooManyRequests = (message = "Too many requests") =>
  new AppError(429, "rate_limited", message);
