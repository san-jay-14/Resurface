import { authClient } from "./auth";
import { env } from "./env";

/** Error envelope the API returns: `{ error: { code, message, requestId } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  query?: Query;
  /** JSON body, or FormData for multipart uploads. */
  body?: unknown;
  signal?: AbortSignal;
  /** Per-request timeout. Render's free tier can cold-start for ~1 minute, so the default is generous. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

let unauthorizedHandler: (() => void) | null = null;

/** Registered by AuthProvider: called when the API rejects the session (expired or revoked). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

function buildUrl(path: string, query?: Query): string {
  const url = new URL(`${env.apiUrl}/v1${path}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function parseError(res: Response): Promise<ApiError> {
  let code = "http_error";
  let message = `Request failed (${res.status})`;
  let requestId: string | undefined;
  try {
    const data = (await res.json()) as { error?: { code?: string; message?: string; requestId?: string } };
    code = data.error?.code ?? code;
    message = data.error?.message ?? message;
    requestId = data.error?.requestId;
  } catch {
    // Non-JSON error body (proxy page, cold-start gateway): keep the generic message.
  }
  return new ApiError(res.status, code, message, requestId);
}

/** Send one request with an explicit credential header. Shared by the session and share-token paths. */
export async function send<T>(
  method: string,
  path: string,
  headers: Record<string, string>,
  opts: RequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  opts.signal?.addEventListener("abort", () => controller.abort());

  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  const init: RequestInit = {
    method,
    headers: {
      Accept: "application/json",
      ...(opts.body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    // The session travels in an explicit Cookie header; never let the platform jar add its own.
    credentials: "omit",
    signal: controller.signal,
    ...(opts.body !== undefined
      ? { body: isForm ? (opts.body as FormData) : JSON.stringify(opts.body) }
      : {}),
  };

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), init);
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new ApiError(
      0,
      aborted ? "timeout" : "network",
      aborted ? "The server took too long to respond." : "Can't reach the server. Check your connection.",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function request<T>(method: string, path: string, opts?: RequestOptions): Promise<T> {
  const cookie = await authClient.getCookie();
  const headers: Record<string, string> = cookie ? { Cookie: cookie } : {};
  try {
    return await send<T>(method, path, headers, opts);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) unauthorizedHandler?.();
    throw err;
  }
}

export const api = {
  get: <T>(path: string, query?: Query, opts?: Omit<RequestOptions, "query" | "body">) =>
    request<T>("GET", path, { ...opts, query }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body">) =>
    request<T>("POST", path, { ...opts, body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, { body }),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, { body }),
  delete: <T = void>(path: string, body?: unknown) =>
    request<T>("DELETE", path, body === undefined ? {} : { body }),
};
