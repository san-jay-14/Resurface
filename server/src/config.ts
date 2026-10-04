import { z } from "zod";

/**
 * All configuration comes from the environment and is validated once at boot,
 * so a missing or malformed value fails fast with a readable message instead
 * of surfacing later as a confusing runtime error.
 */

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const optionalNumber = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === "") return fallback;
      const n = Number(v);
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: "custom", message: `"${v}" is not a number` });
        return z.NEVER;
      }
      return n;
    });

const optionalBool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v === "" ? fallback : ["1", "true", "yes"].includes(v.toLowerCase()),
    );

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: optionalNumber(8080),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  // Database. Neon: DATABASE_URL = pooled (-pooler) string; DATABASE_URL_DIRECT = direct string,
  // used for migrations (session-level locks do not work through the transaction pooler).
  DATABASE_URL: optionalString,
  DATABASE_URL_DIRECT: optionalString,
  DB_POOL_MAX: optionalNumber(5),
  MIGRATE_ON_BOOT: optionalBool(true),

  // Auth
  BETTER_AUTH_SECRET: optionalString,
  PUBLIC_URL: optionalString, // public base URL of this API, e.g. https://dibs-api.onrender.com
  APP_SCHEMES: z.string().default("resurface,dibs"), // deep-link schemes the mobile app registers
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  APPLE_CLIENT_ID: optionalString, // Services ID (web flow) or bundle id (native id-token flow)
  APPLE_CLIENT_SECRET: optionalString,
  APPLE_APP_BUNDLE_ID: optionalString,

  // Service-to-service
  TICK_SECRET: optionalString, // shared secret for POST /internal/tick (cron-job.org)
  ADMIN_DASHBOARD_TOKEN: optionalString,

  // Object storage (Cloudflare R2, S3-compatible)
  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET: optionalString,
  R2_PUBLIC_BASE_URL: optionalString, // public URL prefix for public objects (custom domain or r2.dev)

  // Providers
  ANTHROPIC_API_KEY: optionalString,
  HIKERAPI_KEY: optionalString,
  HIKERAPI_BASE_URL: z.string().default("https://api.hikerapi.com"),
  HIKERAPI_COST_PER_CALL: optionalNumber(0.0006),
  HIKERAPI_V1_BY_URL_PATH: z.string().default("/v1/media/by/url"),
  HIKERAPI_COMMENTS_PATH: z.string().default("/v2/media/comments"),
  YOUTUBE_API_KEY: optionalString,
  GOOGLE_PLACES_API_KEY: optionalString,
  ALERT_WEBHOOK_URL: optionalString,
  CANARY_IG_SHORTCODE: optionalString,
  // Extra stable public posts, comma-separated; probed through every enabled Instagram provider.
  CANARY_IG_SHORTCODES: optionalString,
  // Ordered, comma-separated Instagram metadata providers ("hikerapi"). Empty disables them all and
  // the pipeline degrades to device metadata / thumbnail-only. Unknown names fail fast at boot.
  IG_PROVIDER_ORDER: z.string().default("hikerapi"),
  CANARY_YT_ID: z.string().default("jNQXAC9IVRw"),

  // Classifier / pipeline tuning
  CLASSIFIER_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  RULES_MODEL: z.string().default("claude-sonnet-4-20250514"), // rule parsing + Wrapped copy
  COPY_MODEL: z.string().default("claude-haiku-4-5-20251001"), // push notification copy
  EXPO_ACCESS_TOKEN: optionalString, // only if "enhanced push security" is enabled in Expo
  PROMPT_VERSION: optionalNumber(1),
  CONFIDENCE_THRESHOLD: optionalNumber(0.6),
  DRAIN_BATCH_SIZE: optionalNumber(20),
  DRAIN_CONCURRENCY: optionalNumber(5),
  DRAIN_BUDGET_MS: optionalNumber(100_000),
  MAX_ATTEMPTS: optionalNumber(5),
  USER_DAILY_ENRICH_CAP: optionalNumber(50),
  USER_ENQUEUE_PER_MINUTE: optionalNumber(30),
  BREAKER_THRESHOLD: optionalNumber(5),
  BREAKER_BASE_MINUTES: optionalNumber(5),
  DEAD_JOBS_ALERT_THRESHOLD: optionalNumber(10),
  ANTHROPIC_IN_PER_MTOK: optionalNumber(1),
  ANTHROPIC_OUT_PER_MTOK: optionalNumber(5),
  PLACE_RESOLUTION_CATEGORIES: z.string().default("Places,Fashion"),
  // Daily spend caps per paid provider (USD; YouTube in quota units).
  BUDGET_HIKERAPI: optionalNumber(5),
  BUDGET_ANTHROPIC: optionalNumber(5),
  BUDGET_GOOGLE_PLACES: optionalNumber(5),
  BUDGET_YOUTUBE_DATA_API: optionalNumber(9000),
  FFMPEG_ENABLED: optionalBool(false), // video rung of the frames ladder (needs ffmpeg on PATH)
});

export type Env = z.infer<typeof schema>;

export interface Config {
  env: Env["NODE_ENV"];
  isProduction: boolean;
  port: number;
  logLevel: Env["LOG_LEVEL"];
  db: {
    url: string | undefined;
    directUrl: string | undefined;
    poolMax: number;
    migrateOnBoot: boolean;
  };
  auth: {
    secret: string | undefined;
    publicUrl: string | undefined;
    appSchemes: string[];
    google: { clientId: string; clientSecret: string } | undefined;
    apple:
      | { clientId: string; clientSecret: string; appBundleIdentifier: string | undefined }
      | undefined;
  };
  tickSecret: string | undefined;
  adminToken: string | undefined;
  r2:
    | {
        accountId: string;
        accessKeyId: string;
        secretAccessKey: string;
        bucket: string;
        publicBaseUrl: string;
      }
    | undefined;
  providers: {
    anthropicKey: string | undefined;
    hikerKey: string | undefined;
    hikerBase: string;
    hikerCostPerCall: number;
    hikerV1Path: string;
    hikerCommentsPath: string;
    youtubeKey: string | undefined;
    placesKey: string | undefined;
    alertWebhookUrl: string | undefined;
    expoAccessToken: string | undefined;
    igProviderOrder: string[];
  };
  canary: { igShortcodes: string[]; ytId: string };
  pipeline: {
    classifierModel: string;
    rulesModel: string;
    copyModel: string;
    promptVersion: number;
    confidenceThreshold: number;
    drainBatchSize: number;
    drainConcurrency: number;
    drainBudgetMs: number;
    maxAttempts: number;
    userDailyCap: number;
    userEnqueuePerMinute: number;
    breakerThreshold: number;
    breakerBaseMinutes: number;
    deadJobsAlertThreshold: number;
    anthropicInPerMTok: number;
    anthropicOutPerMTok: number;
    placeResolutionCategories: string[];
    budgets: Record<string, number>;
    ffmpegEnabled: boolean;
  };
}

export class ConfigError extends Error {
  constructor(public issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

const MIN_SECRET = 32;

/** Instagram metadata providers the server knows how to build (see adapters/instagram.ts). */
export const IG_PROVIDER_NAMES = ["hikerapi"] as const;

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`),
    );
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === "production";

  const problems: string[] = [];
  const need = (name: string, value: unknown, min = 1) => {
    if (!value || (typeof value === "string" && value.length < min)) {
      problems.push(`${name} is required in production${min > 1 ? ` (min ${min} chars)` : ""}`);
    }
  };
  if (isProduction) {
    need("DATABASE_URL", e.DATABASE_URL);
    need("BETTER_AUTH_SECRET", e.BETTER_AUTH_SECRET, MIN_SECRET);
    need("PUBLIC_URL", e.PUBLIC_URL);
    need("TICK_SECRET", e.TICK_SECRET, 24);
    if (e.ADMIN_DASHBOARD_TOKEN && e.ADMIN_DASHBOARD_TOKEN.length < 24) {
      problems.push("ADMIN_DASHBOARD_TOKEN must be at least 24 chars when set");
    }
  }
  if (e.PUBLIC_URL && !/^https?:\/\//.test(e.PUBLIC_URL))
    problems.push("PUBLIC_URL must be an http(s) URL");
  const r2Vars = [
    e.R2_ACCOUNT_ID,
    e.R2_ACCESS_KEY_ID,
    e.R2_SECRET_ACCESS_KEY,
    e.R2_BUCKET,
    e.R2_PUBLIC_BASE_URL,
  ];
  if (r2Vars.some(Boolean) && !r2Vars.every(Boolean)) {
    problems.push(
      "R2_* settings must be provided together (ACCOUNT_ID, ACCESS_KEY_ID, SECRET_ACCESS_KEY, BUCKET, PUBLIC_BASE_URL)",
    );
  }
  const igOrder = e.IG_PROVIDER_ORDER.split(",")
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
  for (const n of igOrder) {
    if (!(IG_PROVIDER_NAMES as readonly string[]).includes(n)) {
      problems.push(
        `IG_PROVIDER_ORDER: unknown provider "${n}" (known: ${IG_PROVIDER_NAMES.join(", ")})`,
      );
    }
  }
  if (problems.length) throw new ConfigError(problems);

  return {
    env: e.NODE_ENV,
    isProduction,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    db: {
      url: e.DATABASE_URL,
      directUrl: e.DATABASE_URL_DIRECT ?? e.DATABASE_URL,
      poolMax: e.DB_POOL_MAX,
      migrateOnBoot: e.MIGRATE_ON_BOOT,
    },
    auth: {
      secret: e.BETTER_AUTH_SECRET,
      publicUrl: e.PUBLIC_URL?.replace(/\/+$/, ""),
      appSchemes: e.APP_SCHEMES.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      // Like Apple, Google sign-in is the native ID-token flow: the app obtains the token, the server
      // verifies it against this (web) client id as the audience. No redirect, so no client secret.
      google: e.GOOGLE_CLIENT_ID
        ? {
            clientId: e.GOOGLE_CLIENT_ID,
            clientSecret: e.GOOGLE_CLIENT_SECRET ?? "native-id-token-flow-only",
          }
        : undefined,
      // The app only uses Apple's native identity-token flow, which verifies the token's audience
      // and never needs the (6-monthly rotating) client-secret JWT, so a placeholder is fine.
      apple: e.APPLE_CLIENT_ID
        ? {
            clientId: e.APPLE_CLIENT_ID,
            clientSecret: e.APPLE_CLIENT_SECRET ?? "native-id-token-flow-only",
            appBundleIdentifier: e.APPLE_APP_BUNDLE_ID,
          }
        : undefined,
    },
    tickSecret: e.TICK_SECRET,
    adminToken: e.ADMIN_DASHBOARD_TOKEN,
    r2:
      e.R2_ACCOUNT_ID &&
      e.R2_ACCESS_KEY_ID &&
      e.R2_SECRET_ACCESS_KEY &&
      e.R2_BUCKET &&
      e.R2_PUBLIC_BASE_URL
        ? {
            accountId: e.R2_ACCOUNT_ID,
            accessKeyId: e.R2_ACCESS_KEY_ID,
            secretAccessKey: e.R2_SECRET_ACCESS_KEY,
            bucket: e.R2_BUCKET,
            publicBaseUrl: e.R2_PUBLIC_BASE_URL.replace(/\/+$/, ""),
          }
        : undefined,
    providers: {
      anthropicKey: e.ANTHROPIC_API_KEY,
      hikerKey: e.HIKERAPI_KEY,
      hikerBase: e.HIKERAPI_BASE_URL,
      hikerCostPerCall: e.HIKERAPI_COST_PER_CALL,
      hikerV1Path: e.HIKERAPI_V1_BY_URL_PATH,
      hikerCommentsPath: e.HIKERAPI_COMMENTS_PATH,
      youtubeKey: e.YOUTUBE_API_KEY,
      placesKey: e.GOOGLE_PLACES_API_KEY,
      alertWebhookUrl: e.ALERT_WEBHOOK_URL,
      expoAccessToken: e.EXPO_ACCESS_TOKEN,
      igProviderOrder: igOrder,
    },
    canary: {
      igShortcodes: [
        ...new Set(
          [e.CANARY_IG_SHORTCODE, ...(e.CANARY_IG_SHORTCODES ?? "").split(",")]
            .map((c) => c?.trim())
            .filter((c): c is string => !!c),
        ),
      ],
      ytId: e.CANARY_YT_ID,
    },
    pipeline: {
      classifierModel: e.CLASSIFIER_MODEL,
      rulesModel: e.RULES_MODEL,
      copyModel: e.COPY_MODEL,
      promptVersion: e.PROMPT_VERSION,
      confidenceThreshold: e.CONFIDENCE_THRESHOLD,
      drainBatchSize: e.DRAIN_BATCH_SIZE,
      drainConcurrency: e.DRAIN_CONCURRENCY,
      drainBudgetMs: e.DRAIN_BUDGET_MS,
      maxAttempts: e.MAX_ATTEMPTS,
      userDailyCap: e.USER_DAILY_ENRICH_CAP,
      userEnqueuePerMinute: e.USER_ENQUEUE_PER_MINUTE,
      breakerThreshold: e.BREAKER_THRESHOLD,
      breakerBaseMinutes: e.BREAKER_BASE_MINUTES,
      deadJobsAlertThreshold: e.DEAD_JOBS_ALERT_THRESHOLD,
      anthropicInPerMTok: e.ANTHROPIC_IN_PER_MTOK,
      anthropicOutPerMTok: e.ANTHROPIC_OUT_PER_MTOK,
      placeResolutionCategories: e.PLACE_RESOLUTION_CATEGORIES.split(",").map((s) => s.trim()),
      budgets: {
        hikerapi: e.BUDGET_HIKERAPI,
        anthropic: e.BUDGET_ANTHROPIC,
        google_places: e.BUDGET_GOOGLE_PLACES,
        youtube_data_api: e.BUDGET_YOUTUBE_DATA_API,
      },
      ffmpegEnabled: e.FFMPEG_ENABLED,
    },
  };
}

export const CATEGORY_LABELS = [
  "Places",
  "Recipes",
  "Fashion",
  "Shopping",
  "Watch/Learn",
  "Inspo",
] as const;
export type CategoryLabel = (typeof CATEGORY_LABELS)[number];

/** Classifier labels -> stored category values. */
export const LABEL_TO_CATEGORY: Record<CategoryLabel, string> = {
  Places: "places",
  Recipes: "recipes",
  Fashion: "fashion",
  Shopping: "shopping",
  "Watch/Learn": "watch_learn",
  Inspo: "inspo",
};
