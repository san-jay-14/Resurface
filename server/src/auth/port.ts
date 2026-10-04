/**
 * What the HTTP layer needs from the auth system. Production implements this with Better Auth;
 * tests substitute a header-driven fake so route authorization can be tested without OAuth.
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthPort {
  /** Serves `/api/auth/*` (sign-in, callbacks, sign-out, session). */
  handler(request: Request): Promise<Response>;
  /** Resolve the signed-in user from the request headers (session cookie), or null. */
  getSession(headers: Headers): Promise<SessionUser | null>;
}
