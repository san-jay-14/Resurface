import { expo } from "@better-auth/expo";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import type { Pool } from "pg";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import { ensureProfile } from "../db/repos/users.ts";
import type { Logger } from "../logger.ts";
import type { AuthPort } from "./port.ts";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

/**
 * Better Auth, self-hosted on our own Postgres. Sign-in methods:
 *  - Google: redirect flow through this server (`/api/auth/callback/google`)
 *  - Apple:  native identity token (`signIn.social({ idToken })`), no redirect/client-secret needed
 * There is deliberately no email/password and no anonymous mode.
 */
export function buildAuthOptions(config: Config, pool: Pool, db: Db, log: Logger) {
  const { auth: a } = config;
  if (!a.secret || !a.publicUrl) {
    throw new Error("BETTER_AUTH_SECRET and PUBLIC_URL are required to start the auth system");
  }

  return {
    database: pool,
    secret: a.secret,
    baseURL: a.publicUrl,
    basePath: "/api/auth",
    // Deep-link schemes registered by the mobile app; `exp://` only for Expo Go during development.
    trustedOrigins: [
      ...a.appSchemes.flatMap((s) => [`${s}://`, `${s}://*`]),
      ...(config.isProduction ? [] : ["exp://**"]),
    ],
    plugins: [expo()],
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: config.isProduction,
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    session: { expiresIn: THIRTY_DAYS, updateAge: 60 * 60 * 24 },
    account: { accountLinking: { enabled: true, trustedProviders: ["google", "apple"] } },
    rateLimit: { enabled: true, window: 60, max: 60 },
    socialProviders: {
      ...(a.google
        ? { google: { clientId: a.google.clientId, clientSecret: a.google.clientSecret } }
        : {}),
      ...(a.apple
        ? {
            apple: {
              clientId: a.apple.clientId,
              clientSecret: a.apple.clientSecret,
              ...(a.apple.appBundleIdentifier
                ? { appBundleIdentifier: a.apple.appBundleIdentifier }
                : {}),
            },
          }
        : {}),
    },
    databaseHooks: {
      user: {
        create: {
          // The application profile is created together with the identity.
          after: async (user) => {
            try {
              await ensureProfile(db, user.id);
            } catch (err) {
              // Non-fatal: GET /v1/me self-heals a missing profile.
              log.error({ err, userId: user.id }, "failed to create profile for new user");
            }
          },
        },
      },
    },
  } satisfies BetterAuthOptions;
}

export function createBetterAuthPort(config: Config, pool: Pool, db: Db, log: Logger): AuthPort {
  const auth = betterAuth(buildAuthOptions(config, pool, db, log));

  return {
    handler: (request) => auth.handler(request),
    async getSession(headers) {
      const result = await auth.api.getSession({ headers });
      if (!result) return null;
      return { id: result.user.id, email: result.user.email, name: result.user.name };
    },
  };
}
