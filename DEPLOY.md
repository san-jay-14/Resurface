# Deploying Resurface (Dibs)

Everything runs on free tiers except the usage-billed provider APIs (see [Costs](#costs)).

```
Expo app ──HTTPS──▶ API (server/, Render free web service) ──▶ Neon Postgres (free)
                          │                    ├──▶ Cloudflare R2 (images)
cron-job.org ─ tick + ping┘                    └──▶ Anthropic · HikerAPI · YouTube · Google Places · Expo Push
```

Nothing here is deployed yet. You create four accounts, paste secrets, and push. Order matters.

## 1. Neon (database)

1. Create a project. **Region: the same as Render** (Singapore / `ap-southeast-1` suits an India user base).
2. From **Connect**, copy both strings:
   - **Pooled** (host contains `-pooler`) → `DATABASE_URL` (the app).
   - **Direct** (no `-pooler`) → `DATABASE_URL_DIRECT` (migrations only: they take a lock the transaction pooler can't hold).
3. Migrations run automatically on boot (`MIGRATE_ON_BOOT=true`), forward-only and checksummed.

Free-tier facts the design respects: 100 compute-hours/month and the database suspends after 5 idle minutes
(cannot be disabled). `/healthz` never touches the database and the scheduler ticks every ~15 minutes, which
keeps usage around 60 CU-h. Don't add anything that polls the database every minute.

## 2. Cloudflare R2 (avatars, bug-report screenshots)

R2 needs a card on file for verification; usage inside the free allowance is not charged.

1. Create a bucket (e.g. `dibs`). Enable public access (the `r2.dev` URL, or a custom domain) → `R2_PUBLIC_BASE_URL`.
2. **Manage R2 API tokens** → create a token with *Object Read & Write* on that bucket → `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
3. Account ID (R2 overview page) → `R2_ACCOUNT_ID`; bucket name → `R2_BUCKET`.

Uploads go through the API, which validates the image type and size; the bucket needs no CORS rules.
Without R2 configured the API answers `503 storage_unavailable` for uploads and everything else works.

## 3. Google and Apple sign-in

Sign-in is native: the app obtains an ID token and the API verifies it.

- **Google Cloud → Credentials**: create an **OAuth client, type Web** → its client id is both
  `GOOGLE_CLIENT_ID` (server) and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (app). Create an **Android** client for
  package `com.resurface.app` with the SHA-1 of **each** signing key you use (debug, EAS upload key, Play app
  signing key). `google-services.json` must belong to this project.
- **Apple** (iOS only): enable *Sign in with Apple* for `com.resurface.app`; set `APPLE_CLIENT_ID` and
  `APPLE_APP_BUNDLE_ID` to the bundle id. For an iOS build also add the
  `@react-native-google-signin/google-signin` config plugin with your `iosUrlScheme` to `app.json`.

## 4. Render (the API)

1. **New → Blueprint**, pick this repo; it reads [render.yaml](render.yaml) (Docker, `rootDir: server`, free plan, health check `/healthz`).
2. Fill the `sync: false` secrets in the dashboard. `BETTER_AUTH_SECRET`, `TICK_SECRET` and `ADMIN_DASHBOARD_TOKEN`
   are generated for you; read them from the service's Environment tab.
3. Set `PUBLIC_URL` to the service URL (`https://dibs-api.onrender.com`), then redeploy.
4. Provider keys (`ANTHROPIC_API_KEY`, `HIKERAPI_KEY`, `YOUTUBE_API_KEY`, `GOOGLE_PLACES_API_KEY`) are optional:
   a missing key disables that capability instead of failing. Full list in [server/.env.example](server/.env.example).

Check: `https://<service>/healthz` → `{"status":"ok"}`, `/readyz` → ready (this one wakes the database).

## 5. cron-job.org (keeps the free service awake and drives the scheduler)

Render's free tier sleeps after 15 idle minutes and has no cron. Create two jobs (free):

| Job | URL | Method | Every | Header |
|---|---|---|---|---|
| tick | `https://<service>/internal/tick` | POST | 15 min | `Authorization: Bearer <TICK_SECRET>` |
| keep-alive | `https://<service>/healthz` | GET | 10 min | none |

The tick runs every due task (drain, reaper, canary, reminders, nightly resurface, housekeeping). It is
idempotent and safe to call twice; a late tick just runs the work late. Enable failure notifications in
cron-job.org so you hear when the API stops answering.

## 6. The app

```bash
cp .env.example .env     # set EXPO_PUBLIC_API_URL (the Render URL), EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, EAS + Mapbox ids
npx expo prebuild --clean --platform android   # regenerates android/ (the share worker now targets EXPO_PUBLIC_API_URL)
npm run android
```

`EXPO_PUBLIC_API_URL` must be set for `prebuild` and for EAS builds: the Android share worker reads it into
`BuildConfig.API_URL`, and the prebuild step fails loudly if it is missing. Expo Go is not supported
(`google-signin` is a native module).

## 7. Local development

```bash
cd server && npm ci && cp .env.example .env     # fill DATABASE_URL, BETTER_AUTH_SECRET, TICK_SECRET (use a Neon dev branch)
npm run dev                                     # API on :8787, restarts on change
npm test                                        # 250+ tests on in-memory Postgres, no keys needed
npm run demo                                    # admin dashboard on fake data, no database at all
```

## Manual QA checklist (needs a real device and the live services)

- [ ] Sign in with Google (and Apple on iOS); kill and reopen the app: still signed in.
- [ ] Share an Instagram Reel from the system share sheet: it appears as *Sorting…*, then categorized.
- [ ] Share while the app is closed (Android): notification "Saved to Dibs", and the save is there on open.
- [ ] Create a board, share it, join with the code from a second account; react; leave.
- [ ] Add a rule in plain English, apply it to existing saves.
- [ ] Generate a Wrapped card (needs 15+ saves).
- [ ] Upload an avatar; submit a bug report with a screenshot (objects appear in R2).
- [ ] Receive a push notification and tap it.
- [ ] Sign out: the share token is revoked (a share afterwards fails silently). Delete account: all data gone.
- [ ] `/admin` loads with the token; **Run task → drain** works; the tick shows in *Scheduled tasks*.

## Costs

| Piece | Cost |
|---|---|
| Neon, Render, cron-job.org | $0 (free tiers) |
| Cloudflare R2 | $0 within the free allowance; **card required** |
| Anthropic, HikerAPI, Google Places | **usage-billed, no free tier**; capped by `BUDGET_*` (default $5/day each; lower for a hard ceiling) |
| YouTube Data API | free quota (`BUDGET_YOUTUBE_DATA_API` units/day) |
| Expo Push, Mapbox (within limits) | $0 |

## Known limits of the free setup

- Render free is not SLA-backed and cold-starts in ~1 minute if the pings stop; the app times out after 30 s
  per request and shows a retryable error.
- Background work has ~15-minute granularity when the service is idle (it is immediate when the API is awake,
  because enqueue drains in-process). Reminders arrive within one tick of their time.
- Neon free: 1 GB storage, 6 h point-in-time restore. Back up anything you can't lose.
- The video-frames rung of the pipeline is off (no ffmpeg, too little CPU); thumbnails still work. See
  [ENRICHMENT_PIPELINE.md](ENRICHMENT_PIPELINE.md).
- The seeded calendar (holidays, long weekends) ends in March 2027; add a migration to extend it.
- Moving off Render later (Railway, Fly, a VPS) is a redeploy of the same Dockerfile with the same env vars.
