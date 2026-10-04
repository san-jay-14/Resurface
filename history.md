# Resurface / Dibs — project history log

A chronological record of the work done with Claude Code on this repo: what was asked, every decision and
scope change, what was built (files and key code), every bug met and how it was resolved, and what is still
open. Dates are the session dates (2026-10-02 → 2026-10-04). Where the exact day is uncertain it is marked
"≈". Nothing in this log has been deployed to a hosted environment yet; everything was run locally.

Companion docs: [AGENTS.md](AGENTS.md) (contributor guide) · [DEPLOY.md](DEPLOY.md) (hosting runbook) ·
[ENRICHMENT_PIPELINE.md](ENRICHMENT_PIPELINE.md) (pipeline design) · `server/.env.example` (server config).

---

## 0. Cast, repo and starting point

- **App:** Expo SDK 56 (managed → now with a generated `android/`), expo-router, TypeScript strict, NativeWind v4.
  Package `com.resurface.app`, schemes `resurface` and `dibs`.
- **State at start (before 2026-10-02):** Milestone 1 (auth + onboarding + data model) existed on Supabase
  (Postgres + RLS + Auth + Storage + Realtime + Edge Functions + pg_cron). Git history: `2d7c0e0 Add hosted privacy
  policy page for Play Store submission`, `861c3e8 Prepare Android build config for Play Store submission`, etc.
  Legacy Instagram scraping existed as `scrape-instagram` and `enrich-save` Edge Functions.
- **Source of truth for behaviour:** `resurface-v1-build-spec.md`.
- **Memory notes** (outside repo): `C:\Users\santh\.claude\projects\D--saas-Resurface\memory\` —
  `project_neon_migration.md`, `project_enrichment_pipeline.md`, `project_instagram_scrape_map_milestone.md`,
  `reference_instagram_nologin_scrape.md`, indexed in `MEMORY.md`.

---

## 1. Timeline

### 2026-10-02 — Enrichment pipeline + dashboard (on Supabase)

**Request.** Analyse the app and implement "dibs. Enrichment Pipeline — Claude Code Handoff Spec"
(`D:\Downloads\dibs. Enrichment Pipeline — Claude Code Handoff Spec.md`): URL canonicalization, Instagram /
YouTube / web adapters, global post + analysis cache, Postgres job queue, comments/frames fallback ladder, Haiku
classification, production controls, a frames worker — plus **a simple web dashboard that shows and logs every
pipeline step with success and error messages**.

**Built (Deno / Supabase flavour, later ported):**
- Migration `supabase/migrations/20261002000023_enrichment_pipeline.sql`: `job_queue`, `post_cache`,
  `post_analysis`, `post_cache_lock`, `provider_health`, `provider_calls`, `pipeline_events`, alerts, views
  (`v_dead_letter`, …), functions `claim_jobs` (skip locked), `post_cache_lock`, `provider_record` (atomic
  breaker + spend), `reap_stuck_jobs`, `enqueue_youtube_refresh`, pg_cron schedules.
- Shared pipeline code under `supabase/functions/_shared/` (adapters `instagram`/`youtube`/`web`/`ssrf`/`registry`,
  providers `hikerapi`/`youtube_api`, pipeline `process`/`ladder`/`classify`/`cache`/`drain`/`health`/`places`).
- Edge Functions: `enqueue-save`, `enrich-drain`, `pipeline-canary`, `pipeline-admin`.
- `workers/frames/` (ffmpeg frames worker, Deno, Dockerfile for Railway).
- `dashboard/index.html` + `dashboard/demo.ts` (dashboard on fake data).
- 41 shared Deno tests + 14 worker tests; SQL validated on PGlite.
- Client: `lib/saves.ts` `enqueueSave()` used the new path; `lib/env.ts` feature flag added then removed.

**Rules adopted from the spec (still enforced):** cache the *post*, not the save; no `if (platform === …)` outside
`adapters/`; fail soft; idempotent; budgeted; observable.

**Scope change #1 — "one single logic".** User: *"i dont need lot of implementations, lot of booleans to set and
unset - one single logic, the current remove everything else."* Result: the pipeline became the **only** enrichment
path. Deleted `scrape-instagram`, `enrich-save`, the `EXPO_PUBLIC_ENRICHMENT_PIPELINE` flag and every legacy branch.
Share screen, headless task and Android `SaveWorker` all call `enqueue-save`.

**Bugs found while building (all fixed):**
| Bug | Fix |
|---|---|
| Web adapter's `contentId` was a one-way hash, so the URL couldn't be refetched | `fetchMeta(contentId, hint?: { sourceUrl })` |
| Instagram `/share/{token}` links parsed as a shortcode | `parseInstagramPath` returns null when `segs[0] === 'share'` |
| Heredocs in the Bash tool failed ("unexpected EOF") for big files | use the Write tool / python scripts instead |
| Windows Python defaulted to cp1252 and choked on UTF-8 | always `open(..., encoding='utf-8')` |
| A repo-wide Grep hung (it walked `android/`) | scope greps to source dirs |

### 2026-10-02 → 2026-10-03 — Decision: leave Supabase for Neon

**Trigger.** User: *"i want to migrate to neondb"*, then *"Full replacement, move everything to Neon - because my free
tier is full. make sure everythign should be production grade , with proper code quality"*.

**Analysis.** Neon is plain Postgres only. Supabase had also been providing Auth, Storage, Realtime, Edge
Functions, pg_cron/pg_net, and RLS-based authorization — each needs a replacement we own.

**Decisions (via questions to the user):**
| Question | Answer |
|---|---|
| Hosting ("$0, even a workaround") | Render free web service + cron-job.org pings |
| Storage | Cloudflare R2 (card on file for verification only) |
| Existing data | Start fresh, no migration |
| Auth | Better Auth, self-hosted (not Neon Auth — AWS-only, no Apple/anonymous/Expo docs) |
| Realtime | Replaced by polling while a save is pending |
| Guest/anonymous sign-in | Dropped (nothing in the UI used it) |
| Cost honesty | Documented that Render free sleeps / isn't production-grade; HikerAPI, Anthropic, Google Places stay paid (daily caps default $5) |

An approved plan lives at `C:\Users\santh\.claude\plans\fluttering-jumping-harp.md` (phases 0–7).

**Neon free-tier constraints designed around:** 100 CU-h/month, auto-suspend after 5 min (can't disable),
PgBouncer transaction pooler (no LISTEN/NOTIFY, no session advisory locks). So: `/healthz` never touches the DB;
scheduler ticks ~15 min; pooled URL for the app, **direct** URL for migrations; migrations use
`pg_advisory_xact_lock` inside a transaction.

### 2026-10-02 → 2026-10-03 — Server build (phases 0–5): `server/`

New package `server/` (Node 22, Hono, TypeScript strict + `noUncheckedIndexedAccess`, ESLint, Prettier, vitest).

**Tooling/config:** `package.json`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.mjs`, `.prettierrc.json`,
`vitest.config.ts` (globalSetup + setupFiles, `pool: "forks"`), `.gitignore`, `src/config.ts` (zod-validated env,
fail fast in production), `src/logger.ts` (pino, secret redaction), `src/errors.ts` (`AppError` + helpers),
`src/util.ts`, `src/main.ts` (composition root: migrate on boot via direct URL, pools, pipeline context, drain
kicker, tasks, Better Auth port, temp sweep, graceful shutdown).

**Database (`server/migrations/`, forward-only, checksummed):**
- `0001_auth.sql` — Better Auth tables `user/session/account/verification` (uuid ids, camelCase quoted columns).
- `0002_core.sql` — `users` (profile), `user_sub_categories`, `saves` (text + CHECK enums, `platform/content_id`,
  `enrichment_*`, `updated_at` + touch trigger, FTS index, `unique(user_id, platform, content_id)`),
  `save_locations`, `collections` (`owner_id` only), `collection_saves`, `collection_members`,
  `collection_save_reactions`, `user_rules`, `archived_saves`, `wrapped_history`, `bug_reports`, `device_tokens`,
  `notification_log`, `calendar_events` (`unique(name, date, region)`), `share_tokens`, `scheduled_tasks`.
- `0003_pipeline.sql` — pipeline tables/functions/views carried over, minus RLS/grants/cron:
  `claim_jobs(batch, stages)`, `post_cache_lock(..., p_force)`, `provider_record`, `provider_open_until`,
  `alert_try`, `user_enrichment_count_today(uuid, bigint)`, `reap_stuck_jobs`, `enqueue_youtube_refresh`, views.
- `0004_seed_calendar.sql` — 20 Indian calendar events (ends 2027-03).
- Dropped as dead: `generate-monthly-wrapped` cron (pointed at a non-existent function; also an LLM cost per
  user), `queue-cleanup-notifications` (wrote log rows nothing read and polluted push throttling), `user_events`
  table, `users.last_notified_at`, `is_guest`, `notif_frequency_pref`.

**DB layer:** `src/db/client.ts` (`Db`/`Queryable`, `one`, `json`, int8→number and date→string parsers,
`createPgPool`, `dbFromPool` with connect retry for Neon cold starts), `src/db/migrate.ts` (checksummed runner,
advisory *xact* lock), `src/dev/pglite.ts` (PGlite adapter used by tests/demo).

**Repos (`src/db/repos/`)** — every user-owned query takes `userId`: `users`, `shareTokens`, `notifications`,
`saves`, `boards`, `subCategories`, `bugReports`, `pipelineCache`, `pipelineJobs`, `pipelineHealth`,
`pipelineEvents`, `pipelineAdmin`, `enrichment`, `scheduler`, `resurface`, `rules`, `wrapped`.

**Auth (`src/auth/`):** `port.ts` (`AuthPort`), `betterAuth.ts` — Better Auth on the `pg` pool with
`advanced.database.generateId: "uuid"`, Expo plugin, account linking (google/apple),
`databaseHooks.user.create.after → ensureProfile`, `trustedOrigins` for the app schemes.

**HTTP (`src/http/`):** `app.ts` (middleware order, `/api/auth/*`, `/v1` with body limits 256 KB JSON / 22 MB
uploads and rate limit 240/min, enqueue before `authenticate`), `context.ts`, `middleware.ts` (requestContext,
accessLog, error envelope `{error:{code,message,requestId}}`, rateLimit, `authenticate` with optional
`ShareToken` auth), `validate.ts`; routes: `health` (`/healthz`, `/readyz`), `me`, `devices`, `saves`, `boards`,
`subCategories`, `enqueue`, `internal` (`POST /internal/tick`, bearer `TICK_SECRET`, `?wait=true`), `admin`
(`GET /admin` HTML with CSP + `POST /admin/api`, `x-admin-token`), `rules`, `wrapped`, `uploads`.

**Pipeline port (`src/pipeline`, `src/adapters`, `src/providers`):** `context` (DI via `PipelineContext`),
`trace`, `health` (availability/alert/callProvider, backoff, `nextPacificMidnight`), `classify`, `ladder`,
`places`, `cache`, `canonicalize`, `process`, `drain`, `frames`, `extract` (ffmpeg via `execFile`, imagescript
phash), `canary`; adapters `types/comments/ssrf/instagram/youtube/youtubeAcquire(stub)/web/registry`;
providers `hikerapi`, `youtubeApi`, `anthropic` (`LlmClient`).

**Domain, push, scheduler, storage:** `src/domain/` (resurface rules + engine `runResurface`/`runReminders`, rules,
wrapped), `src/push/expo.ts` (chunks of 100, prunes `DeviceNotRegistered`), `src/scheduler/`
(`schedule`, `runner` with atomic claims, `tasks`, `kicker` with backoff timers), `src/storage/`
(`objectStore` R2 via aws4fetch with `deletePrefix({except})`, `memoryStore`, `images.detectImage` magic bytes).

**Scheduled tasks:** `drain` (every minute), `reaper` (5 min), `canary` (15 min), `purge-cache` (hourly),
`housekeeping` (daily 03:17), `resurface` (daily 04:30 UTC), `reminders` (every minute; quiet hours 21:00–09:00 IST),
`refresh-youtube` (daily 02:23).

**Ported-logic fixes (vs the legacy functions):** real service auth; injected `now` (testable); Expo batching +
token pruning; per-city saves scoped to the user (was unscoped `ilike`) with escaped wildcards; transactional log
row + compensating delete; rule JSON validated by strict schema and evaluator supports exactly what the prompt
advertises; invite codes generated server-side and never overwritten; archive in one transaction; join bug
(`save_count`) fixed.

**Admin dashboard:** `public/admin/index.html` — same-origin `/admin/api`, token-only, scheduled-tasks panel.
`scripts/demo.ts` runs the real server on PGlite with a stubbed internet and seeded scenarios
(port 8787, token `demo-admin-token-0123456789`).

**Tests (`server/test/`):** migrations, foundation, me, saves, boards, **crossTenant**, authSchema (Better Auth
schema against real `pg` through pglite-socket), pipeline, unit, frames, scheduler, enqueue, admin, resurface,
rules, wrapped, uploads. Helpers: `app.ts`, `testDb.ts`, `globalSetup.ts`, `setup.ts`, `factories.ts`, `world.ts`.

**Bugs found while building the server (all fixed):**
| Bug | Resolution |
|---|---|
| Re-running a migration hit `duplicate_table` on a unique constraint | catch `duplicate_object or duplicate_table` |
| PGlite adapter reported `rowCount = 0` for SELECT | `Math.max(affectedRows, rows.length)` |
| `Row` index-signature type errors | repos use `T extends object` |
| Hono `Context` generics broke body-limit selection | typed `MiddlewareHandler<AppEnv>` `selectLimit` |
| Reminder claim used DB `now()` instead of the injected clock | `claimDueReminders(q, now, limit)` |
| Every vitest worker rebuilt the PGlite template → first-test timeouts | vitest `globalSetup` builds one migrated snapshot (`PGLITE_TEMPLATE`), workers clone it |
| Unsafe `any` in the SSRF reader, unbound method in drain | typed readers, bound methods |
| Prettier reformatting broke later python string replacements | re-apply edits against the current text |
| Accidentally ran `git stash` / `stash pop` | verified nothing was lost |
| A test expectation (user count after the reaper) was wrong | corrected the test |

### 2026-10-03 — Client migration (phase 6)

**Dependencies:** added `better-auth`, `@better-auth/expo`, `@react-native-google-signin/google-signin`,
`expo-network`; removed `@supabase/supabase-js`, `expo-auth-session`; removed old scripts
(`test:pipeline`, `test:frames`, `dashboard`, `dashboard:demo`); added `server:dev`, `server:test`, `server:demo`.

**New client foundation:**
- `lib/env.ts` — requires `EXPO_PUBLIC_API_URL` (trailing slashes stripped); Supabase vars removed.
- `lib/auth.ts` — `createAuthClient({ baseURL, plugins: [expoClient({ scheme: "resurface", storagePrefix: "dibs",
  storage: SecureStore })] })`.
- `lib/api.ts` — typed fetch: session sent as an explicit `Cookie` from `await authClient.getCookie()` with
  `credentials: "omit"`; `ApiError(status, code, message, requestId)`; 30 s default timeout (Render cold starts);
  FormData support; `send()` shared by the session and share-token paths; `setUnauthorizedHandler` for 401.
- `lib/database.types.ts` — re-based on the API's JSON: removed `is_guest`, `notif_frequency_pref`,
  `last_notified_at`, `UserEvent`; `Collection.owner_id`; `BoardSummary`/`BoardMember`/`BoardReaction`/`BoardSave`;
  `Save.updated_at`; rules narrowed to `caption|username|url|platform` × `contains|not_contains|equals` and
  `set_category` only.
- New/rewritten modules: `lib/saves.ts`, `lib/boards.ts` (replaces `collections.ts` + `boardSharing.ts`),
  `lib/profile.ts` (incl. `uploadAvatar`, `deleteAccount`), `lib/subCategories.ts`, `lib/rules.ts`,
  `lib/wrapped.ts`, `lib/bugReports.ts`, `lib/shareToken.ts`, `lib/notifications.ts` (PUT/DELETE
  `/v1/device-tokens`, `POST /v1/notifications/:id/tapped`), `lib/location.ts` (`GET /v1/saves/city`, `PATCH /v1/me`).
  `lib/supabase.ts`, `lib/collections.ts`, `lib/boardSharing.ts` deleted.
- `hooks/useSavesFeed.ts` — replaces the single Realtime channel: refetch on mount/foreground/pull-to-refresh and
  poll `GET /v1/saves?updated_since=` (4 s for the first minute, then 15 s) **only while some save is pending**.
- `providers/AuthProvider.tsx` — rewritten: `authClient.useSession()`; Google via
  `GoogleSignin.configure({ webClientId })` → `authClient.signIn.social({ provider: "google", idToken: { token } })`;
  Apple via `expo-apple-authentication` → `signIn.social({ provider: "apple", idToken })`; guest sign-in removed;
  profile from `GET /v1/me`; share token minted after sign-in; sign-out revokes the share token and
  unregisters the device token *before* destroying the session; 401 handler signs out locally.

**Share token design (Android native worker + headless task):** `POST /v1/share-token` returns `dst_…`
(SHA-256 stored server-side, max 10 active per user, scope = `POST /v1/saves/enqueue` only via
`Authorization: ShareToken <t>`); client stores it in AsyncStorage key `dibs.share`; the Kotlin `SaveWorker`
reads that key straight from `RKStorage`; revoked on sign-out.

**Screens updated (all Supabase calls removed):** `app/_layout.tsx` (notification tap → `markNotificationTapped`,
invite deep links now pass the code through), `(app)/index.tsx` (feed hook, "Near you" via `fetchPlacesMapSaves`),
`activity`, `board/category`, `board/[id]`, `boards`, `boards/create`, `boards/invite`, `cleanup/index`,
`location-picker`, `move-board`, `profile`, `save/[id]`, `search`, `settings/archived`, `settings/edit-profile`
(avatar via `/v1/me/avatar`), `settings/index` (display name/avatar from the session, new **Delete account** row),
`settings/notifications`, `settings/report-bug` (attachments now sent as multipart with the report),
`settings/rules` (server returns the applied result synchronously), `wrapped/[id]`, `wrapped/history`,
`(auth)/sign-in`, `(onboarding)/*`, `(share)/index`.

**Android native share path:** `plugins/withHeadlessShare.js` — BuildConfig `API_URL` from
`EXPO_PUBLIC_API_URL` (prebuild fails loudly if missing; idempotent; removes legacy `SUPABASE_*` fields);
generated `SaveWorker.kt` reads `dibs.share`, posts `${API_URL}/v1/saves/enqueue` with `ShareToken`, retries on
5xx/429 only. `tasks/headlessShare.ts` uses `enqueueWithShareToken`.

**Server tweaks made during the client work:** `PATCH /v1/me` `notification_prefs.frequency` enum corrected to
`normal | minimal`; Google client secret made optional (native ID-token flow needs no secret); `trustedOrigins`
now includes `${scheme}://` and `${scheme}://*`; `ensureProfile` copies `"user".image` into `users.avatar_url`;
`listBoards` returns up to 3 cover `thumbnails` per board (profile screen needs them); tests added for both.

**Bugs found during the client migration (all fixed):**
| Bug | Resolution |
|---|---|
| A python edit sliced the wrong `placesCount` occurrence and duplicated half of `(app)/index.tsx` | `git checkout` the file and redo with unique-anchor helpers |
| `location-picker.tsx` edit left a mangled `async function autoDetect    await refreshProfile();` | repaired by hand; uses `setProfile` |
| App `tsc` tried to compile `server/` (`.ts` import extensions) | added `server` to the app `tsconfig` excludes |
| `plugins/withHeadlessShare.js` regex lost escapes after a python rewrite → invalid regex | rewrote the block with a raw string, verified with `node -e` and an idempotency harness against the real `build.gradle` |
| `sign-in.tsx` `run()` expected `Promise<void>` | now `Promise<boolean>` (cancel returns false) |
| Metro bundle check for leftovers | `expo export` succeeded; bundle grep found 0 `supabase` strings |

### 2026-10-03 — Phase 7: ops, docs, cleanup, hardening

**Added:** `server/Dockerfile` (two-stage, node:22-slim, optional ffmpeg via `INSTALL_FFMPEG`, healthcheck),
`server/.dockerignore`, `render.yaml` (Blueprint, free plan, Singapore, `generateValue` for the three secrets),
`.github/workflows/ci.yml` (server lint/typecheck/test/build + app typecheck), `server/.env.example`,
`.env.example` (client), `DEPLOY.md`, rewritten `ENRICHMENT_PIPELINE.md` and `AGENTS.md`.
`server` `dev` script is now `tsx watch --env-file-if-exists=.env src/main.ts`; `tsconfig.build.json` excludes
`src/dev`.

**Deleted:** `supabase/`, `workers/`, `dashboard/` (the migrations remain in git history; the other two were never
committed and are superseded by `server/`).

**Docs/legal edits:** `docs/privacy.html` and `PRIVACY.md` now list Neon, Render, Cloudflare R2 instead of
Supabase and mention in-app account deletion; `PLAY_STORE_SUBMISSION.md` Google OAuth note rewritten.
`.claude/settings.json` was deliberately left untouched (still has a Supabase MCP entry).

**Real bug found by the test suite — timezone:** the budget-cap test started failing consistently around
00:38 local (IST). Cause: SQL used `current_date` (the DB session's timezone) while the JS availability check used
the **UTC** date, so on any non-UTC session the daily spend counter reset itself. Fix: all `current_date` in
`0002_core.sql` and `0003_pipeline.sql` replaced with `(now() at time zone 'utc')::date`. Suite: 251/251 passing.

**Verification at the end of the day:** server `eslint`, `tsc`, `prettier --check` clean; 251 tests pass; app
`tsc` clean; `expo export --platform android` succeeds; privacy/doc grep gate for `supabase` clean except
intentional mentions (history, comments, a test asserting the admin HTML has no "supabase").

### 2026-10-04 — Questions, local run, and getting Google sign-in working

**Q&A (answers given, no code unless noted):**
- *Google OAuth client:* use **Web application** for the id the app/server verify (no redirect URIs/origins needed —
  sign-in is native), plus a second **Android** client (package + SHA-1).
- *Cloudflare R2 credentials:* account id, bucket, public dev URL or custom domain, R2 API token (Object Read &
  Write scoped to the bucket) → the five `R2_*` vars.
- *`TICK_SECRET` / `ADMIN_DASHBOARD_TOKEN`:* generate with `crypto.randomBytes(32).toString('base64url')`
  (or let Render's `generateValue` do it); where each is used.
- *`ALERT_WEBHOOK_URL` / `EXPO_ACCESS_TOKEN`:* both optional; webhook payload is `{text}` (Slack-compatible;
  Discord needs `/slack` appended); the Expo token only matters if Enhanced Push Security is on.
- *Alternatives to Render:* Oracle Always Free VM, Google Cloud Run (caveat: CPU is throttled after the
  response so the in-process drain stalls), Koyeb, Northflank, Railway (not free), own PC + Cloudflare Tunnel.
- *Deploy later:* user chose to run locally first; Neon, R2 and the Google console were set up by the user.

**Config done:** `server/.env` created by the user; `.env.local` and `server/.env` updated to the PC's LAN IP
`192.168.0.124` (`EXPO_PUBLIC_API_URL`, `PUBLIC_URL`); web client id copied across.

**Android build/run — bugs and fixes:**
| # | Symptom | Cause | Resolution |
|---|---|---|---|
| 1 | `./gradlew signingReport` → "SDK location not found" | no `ANDROID_HOME`, no `android/local.properties` | created `android/local.properties` (`sdk.dir=C:/Users/santh/AppData/Local/Android/Sdk`); later set `ANDROID_HOME` + PATH permanently |
| 2 | Gradle: "filename, directory name… syntax is incorrect" | my first `local.properties` lost its backslash escapes | rewrote with forward slashes |
| 3 | Debug SHA-1 needed for the Android OAuth client | — | `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` (SHA-256 `FA:C6:17:45:…:3B:9C`), confirmed against the built APK with `apksigner` |
| 4 | "Frontend still redirects to Supabase" | source and fresh bundle verified clean (0 `supabase` strings, new API URL present) → a **stale install/bundle** on the device | uninstall old app, `prebuild --clean`, rebuild; added a dev-only `API: <url>` marker on the sign-in screen so a stale bundle is obvious (`app/(auth)/sign-in.tsx`) |
| 5 | `expo run:android` → "No Android connected device found" | phone showed only as MTP, USB debugging off/unauthorized; `adb` not on PATH | enabled USB debugging, set PATH/`ANDROID_HOME` |
| 6 | Device flipped `device` → `offline` mid-run | flaky USB link | `adb kill-server` / restart; user re-authorized |
| 7 | `expo run:android --device <serial>` → "Could not find device with name" | Expo wants a device *name*, not the serial | dropped the flag (single device) |
| 8 | App stuck on "Reloading…", logcat `ReconnectingWebSocket` / `BundleDownloader` socket error | screen slept during the first 46 s bundle download, Wi-Fi socket dropped | `svc power stayon usb`, force-stop, relaunch via the dev-client deep link; bundle then loaded in ~1 s |
| 9 | Black screenshots / corrupt PNG | screen asleep; PowerShell `>` re-encodes binary | wake with `input keyevent 224`; use `adb shell screencap` + `adb pull` (and `MSYS_NO_PATHCONV=1` under Git Bash) |
| 10 | `tsx watch` hot-reload failed with `EADDRINUSE` after an edit | restart race with the old process | kill listeners on 8787 and start cleanly |

**Google sign-in — bugs and fixes:**
| # | Symptom | Diagnosis | Resolution |
|---|---|---|---|
| 1 | `DEVELOPER_ERROR` on tapping Continue with Google; no `sign-in` request in the server log | both OAuth clients existed in the same project (`1068081638397`), but `GOOGLE_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` held the **Android** client id (`…-u71ea…`) instead of the **Web** one (`…-4ucg…`) | user pasted the Web client id into both files; server restarted; Metro restarted with `--clear` |
| 2 | "Invalid token" (HTTP 401 on `/api/auth/sign-in/social`; Better Auth log "Invalid id token") | server could reach Google's JWKS and clocks agreed; most likely the first attempt still carried the old id | added a temporary debug log (token `aud/azp/iss/iat/exp`, never the token) — it showed `aud` == expected; next attempt returned **200** and the app reached onboarding; debug code removed |
| 3 | (observation) `google-services.json` belongs to a different Firebase project (`resurface-e0cec`) with no OAuth clients | unrelated to sign-in (the library uses the web client id); only Firebase push would use it | left as is; noted in the open list |

**Result at end of 2026-10-04:** Google sign-in works end to end against the local server and Neon; the app
reaches the onboarding screens ("a few more steps to call dibs."). Server running on `192.168.0.124:8787`,
Metro on `192.168.0.124:8081`.

---

## 2. Architecture as built

```
Expo app ──HTTPS/JSON──▶ server/ (Node 22 + Hono)
                           ├─ Better Auth  (/api/auth/*, native Google + Apple ID-token sign-in) → Neon
                           ├─ REST /v1/*   (authorization in code; replaces RLS)                 → Neon (pooled URL)
                           ├─ pipeline     (adapters / ladder / caches / breakers / frames thumbnails)
                           ├─ domain jobs  (resurface, reminders, rules, wrapped) + Expo push
                           ├─ scheduler    (/internal/tick ◀── cron-job.org every ~15 min; /healthz ping every ~10 min)
                           └─ /admin       (static dashboard + admin API, same origin)
Neon Postgres · Cloudflare R2 (avatars, bug-report screenshots) · Anthropic · HikerAPI · YouTube · Google Places · Expo Push
```

**API surface (`/v1`, zod-validated):** `me` (GET/PATCH/DELETE), `me/avatar` (POST/DELETE), `device-tokens`
(PUT/DELETE), `notifications/:id/tapped`, `share-token` (POST/DELETE), `saves` (list + filters + `updated_since`
+ search, `counts`, `map`, `city`, `manual`, `:id`, `:id/similar`, PATCH, `:id/archive`, `enqueue`), `archived`
(list/restore/delete), `activity`, `boards` (list/create/detail/delete, `:id/saves`, `:id/share`, `join`,
`category-share`, `:id/members/me`, `:id/reactions`, `:id/map`), `sub-categories`, `rules` (create via Claude with
strict schema validation, toggle, delete, apply), `wrapped` (min 15 saves, max 3/day, 6 h reuse), `bug-reports`
(multipart ≤4 images, 5 MB each, magic-byte validated). Ops: `GET /healthz` (no DB), `GET /readyz`,
`POST /internal/tick`, `GET /admin`, `POST /admin/api`.

**Security model:** no RLS — every repo query is scoped by `userId`; shared boards authorize through
`collection_members` (others' saves reduced to a public field subset); cross-tenant matrix in
`server/test/crossTenant.test.ts`; rate limits (global, auth, join, rules, bug reports, avatar, enqueue);
secure headers; error envelope with request ids; secrets redacted from logs; uploads validated server-side.

---

## 3. Scope changes and decisions (in order)

1. 2026-10-02 — Pipeline spec + dashboard requested (original scope).
2. 2026-10-02 — **Single logic only:** remove flags and legacy enrichment paths.
3. 2026-10-02/03 — **Leave Supabase entirely** for Neon (free tier full) with a full replacement of every Supabase
   feature; production-grade quality bar; $0 infrastructure.
4. Hosting: Render free + cron-job.org (instead of paid workers); sleep-tolerant durable scheduler.
5. Storage: Cloudflare R2; uploads go through the API (a presigned PUT can't enforce size/type).
6. Auth: Better Auth self-hosted; **guest mode dropped**; Google changed from the redirect flow to **native
   ID-token** sign-in (so no client secret and no redirect URIs are needed).
7. Realtime → **polling only while a save is pending** (nothing keeps Neon awake).
8. Fresh start: no data migration.
9. Dead features dropped: monthly wrapped cron, notification cleanup cron, `user_events`.
10. Added beyond the plan: in-app **Delete account** (privacy text promises it), `thumbnails` on board summaries,
    avatar seeded from the identity provider, dev-only API marker on the sign-in screen.
11. Frames video rung is **off** on the free host (no ffmpeg, too little CPU); thumbnails rung runs in-process.
12. 2026-10-04 — Deployment deferred; focus on running locally against real Neon + R2.

---

## 4. Commands that matter

```bash
# server (from repo root)
npm run server:dev        # API with .env, hot reload
npm run server:test       # 251 tests, no keys needed
npm run server:demo       # admin dashboard on fake data → http://localhost:8787/admin
# server (inside server/)
npm run lint && npm run typecheck && npm test && npm run build
# app
npx expo prebuild --clean --platform android   # then recreate android/local.properties or set ANDROID_HOME
npx expo run:android
npx expo start --dev-client --clear            # after changing EXPO_PUBLIC_* values
adb devices ; adb kill-server                  # when the device goes offline
```

Windows environment variables set on 2026-10-04: `ANDROID_HOME=C:\Users\santh\AppData\Local\Android\Sdk`,
`…\platform-tools` appended to the user PATH. Phone stay-awake while plugged in: `adb shell svc power stayon usb`
(undo with `adb shell svc power stayon false`).

---

## 5. Open items / not done

- **Nothing is deployed.** Render service not created (user had trouble with Render; alternatives listed above).
  When deploying: create the cron-job.org jobs, set `PUBLIC_URL`, point `EXPO_PUBLIC_API_URL` at the host, rebuild.
- **Google/Apple:** add the debug SHA-1 (done), then the EAS upload key and the Play app-signing SHA-1 to the
  Android client; iOS needs the `@react-native-google-signin/google-signin` config plugin with `iosUrlScheme`
  and Apple setup — neither is configured.
- `google-services.json` points at a different Firebase project (`resurface-e0cec`); regenerate if push via
  Firebase should live under the same project.
- **Pipeline gaps:** HikerAPI v1/comments paths unverified; Anthropic Batch API and prompt caching not built;
  no backfill on `prompt_version` bump; speech detection and thumbnail re-encode not built; place resolution covers
  Places + Fashion; YouTube video acquisition is a stub; SSRF check is per hop (not IP-pinned).
- **Spend:** HikerAPI, Anthropic, Google Places have no free tier; caps default $5/day each.
- **Calendar seed** ends 2027-03 (needs a new migration).
- **Neon SSL warning:** change `sslmode=require` to `sslmode=verify-full` in the Neon URLs to silence it.
- `.claude/settings.json` still references the Supabase MCP and an old export command.
- `.expo/dev/logs/start.log` contains plaintext copies of `.env.local` values (local only; don't share it).
- Remaining manual QA (see `DEPLOY.md`): share flow end to end, boards with a second account, rules, Wrapped,
  avatar upload to R2, push tap, sign-out revoking the share token, account deletion, `/admin`.
- Still to confirm in Neon: `select count(*) from "user"; select id, email, onboarding_completed from users;`
  (my script could not parse `DATABASE_URL` from `server/.env` — only the script, not the server).

---

## 6. File index (what exists now)

**Root:** `AGENTS.md`, `CLAUDE.md`, `DEPLOY.md`, `ENRICHMENT_PIPELINE.md`, `history.md`, `render.yaml`,
`.env.example`, `.github/workflows/ci.yml`, `package.json`, `tsconfig.json`.

**App:** `app/**` (screens listed in §1), `providers/AuthProvider.tsx`, `hooks/useSavesFeed.ts`,
`lib/{api,auth,env,saves,boards,profile,rules,wrapped,subCategories,bugReports,shareToken,notifications,location,activity,database.types}.ts`,
`tasks/headlessShare.ts`, `plugins/withHeadlessShare.js`.

**Server:** `server/{package.json,tsconfig*.json,eslint.config.mjs,vitest.config.ts,Dockerfile,.env.example}`,
`server/migrations/0001–0004`, `server/public/admin/index.html`, `server/scripts/demo.ts`,
`server/src/{config,logger,errors,util,main}.ts`, `server/src/{auth,db,http,pipeline,adapters,providers,domain,push,scheduler,storage,dev}/**`,
`server/test/**` (17 files, 251 tests).
