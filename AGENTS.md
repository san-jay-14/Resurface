# Resurface — agent / contributor guide

A smart second brain for saved content. Sits behind the share button, understands
*why* something was saved, and resurfaces it at the right moment. See
[resurface-v1-build-spec.md](resurface-v1-build-spec.md) — that spec is the
locked source of truth for V1; read it before changing behaviour.

> Expo moves fast. Read the exact versioned docs at
> https://docs.expo.dev/versions/v56.0.0/ before writing native/config code.

## Stack

- **App:** Expo SDK 56 (managed), expo-router (typed routes), TypeScript strict, NativeWind v4 (theme tokens in `tailwind.config.js`)
- **API (`server/`):** Node 22 + Hono + TypeScript strict, zod at every boundary, pino logs, vitest on PGlite
- **Database:** Neon Postgres (plain SQL migrations in `server/migrations/`, applied on boot)
- **Auth:** Better Auth (self-hosted in the API). Native Google + Apple ID-token sign-in; no guest mode
- **Storage:** Cloudflare R2 (S3 API), uploads validated server-side
- **Hosting:** Render free web service + cron-job.org pings — see [DEPLOY.md](DEPLOY.md)

## Layout

| Path | What |
|---|---|
| `app/` | expo-router routes. Groups: `(auth)`, `(onboarding)`, `(app)`, `(share)` |
| `app/_layout.tsx` | Providers + the auth/onboarding **routing gate** |
| `providers/AuthProvider.tsx` | Better Auth session + profile context, sign-in/out, share-token provisioning |
| `lib/api.ts`, `lib/auth.ts` | Typed fetch client (session sent as `Cookie`, `ApiError`, 401 handler) and Better Auth client |
| `lib/*.ts` | One module per API area: `saves`, `boards`, `profile`, `rules`, `wrapped`, `subCategories`, `bugReports`, `shareToken`, `notifications`, `location`, `env`, `database.types` |
| `hooks/useSavesFeed.ts` | Library feed: refetch on focus, poll `updated_since` only while a save is pending (replaces realtime) |
| `tasks/headlessShare.ts`, `plugins/withHeadlessShare.js` | Android share handler (headless JS task + native `SaveWorker`), authenticate with a scoped share token |
| `server/src/http/` | App composition, middleware, `routes/*` (REST under `/v1`, `/internal/tick`, `/admin`) |
| `server/src/db/repos/` | All SQL. **Every user-owned query is scoped by `userId`** |
| `server/src/{pipeline,adapters,providers}/` | Enrichment pipeline — see [ENRICHMENT_PIPELINE.md](ENRICHMENT_PIPELINE.md) |
| `server/src/{domain,push,scheduler,storage}/` | Resurface/rules/wrapped logic, Expo push, durable scheduler, R2 |
| `server/test/` | vitest suites incl. `crossTenant.test.ts` (user B can never touch user A's data) |

## Conventions

- App: import via the `@/` alias (maps to repo root). Screens call `lib/*` functions, never `fetch` directly.
- Client-visible env vars MUST be prefixed `EXPO_PUBLIC_`; read them through `lib/env.ts`.
- **Authorization lives in the API, not the database** (there is no RLS). Every new repo query takes the
  authenticated `userId` and scopes by it; shared boards authorize through `collection_members`. Add every
  new route to the cross-tenant test matrix.
- Keep `lib/database.types.ts` in sync with the API's JSON by hand. Dates are ISO strings on the wire.
- Server env is validated in `server/src/config.ts` (fail fast); document new vars in `server/.env.example`.
- Migrations are forward-only and checksummed: add `server/migrations/NNNN_name.sql`, never edit an applied one.
- Neon free tier: nothing may poll the database on a short interval, and `/healthz` must never touch it.
- No `if (platform === …)` outside `server/src/adapters/`.

## Commands

- App: `npm start` · `npm run android` · `npm run typecheck`
- Server (from repo root): `npm run server:dev` · `npm run server:test` · `npm run server:demo`
- Server (inside `server/`): `npm run lint` · `npm run typecheck` · `npm test` · `npm run build`

## Build status

Milestone 1 (auth + onboarding + data model) is implemented, and the whole backend has been moved from
Supabase to Neon + the self-hosted API. **Nothing is deployed yet** — follow [DEPLOY.md](DEPLOY.md). Next
milestones in spec §11 are tracked there and in the spec.
