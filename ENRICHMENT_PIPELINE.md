# Enrichment pipeline

Implements "dibs. Enrichment Pipeline — Claude Code Handoff Spec" (Oct 2, 2026). A shared Instagram
Reel, YouTube Short or web link becomes a categorized save; every platform detail lives in an adapter.
It runs inside the API server (`server/`) against Neon Postgres.

```
share ─▶ POST /v1/saves/enqueue ─▶ saves row + 1 fetch job ─▶ drain kicker (in-process, immediate)
                                                                   │  (also: scheduler "drain" task, every tick)
                                                                   ▼
                                            drain ─ claim ≤20 jobs, concurrency 5
   1 analysis cache hit? ──yes──▶ copy to save, done (0 provider / 0 model calls)
   2 post cache fresh?   ──yes──▶ skip fetch
   3 provider breaker / budget / per-user cap gate  (stale cache served if breaker open)
   4 single-flight lock ▶ adapter.fetchMeta (batched ≤50 for YouTube) ▶ normalize ▶ cache
   5 ladder: metadata ▶ comments ▶ frames (thumbnails in-process, video needs ffmpeg) ▶ needs_review
   6 place resolution (Places API) ▶ post_analysis (global) ▶ write-back onto the save row
                                                                   │
                                  app polls GET /v1/saves?updated_since=… while a save is pending
```

| Path (under `server/`) | What |
|---|---|
| `migrations/0003_pipeline.sql` | tables, `claim_jobs`, locks, breaker fns, views |
| `src/adapters/` | `types.ts` contract, `instagram.ts`, `youtube.ts`, `web.ts` (+`ssrf.ts`), `registry.ts` |
| `src/providers/` | `hikerapi.ts`, `youtubeApi.ts`, `anthropic.ts` (all calls go through `callProvider`) |
| `src/pipeline/` | `process.ts` (the steps), `ladder.ts`, `classify.ts`, `cache.ts`, `drain.ts`, `health.ts`, `places.ts`, `frames.ts`, `extract.ts`, `canary.ts` |
| `src/scheduler/` | durable task registry + runner behind `POST /internal/tick`, in-process drain kicker |
| `src/db/repos/pipeline*.ts` | SQL for jobs, caches, health, events, admin queries |
| `public/admin/index.html` | web dashboard, served at `/admin` (same origin as the admin API) |

Rule: no `if (platform === …)` outside `adapters/`. Add a platform = one adapter file + one line in `registry.ts`.

## Dashboard

Every pipeline step writes a `pipeline_events` row (step, ok/error/warn/skip/info, message, duration,
details). The dashboard at `/admin` shows them per run, plus jobs, provider calls, breakers, spend,
cache hit rates, the rung that resolved each post, alerts, scheduled tasks, the dead-letter queue (with
retry), feature-flag toggles, and a **Try a URL** dry run that executes every step with no save.
Unlock it with `ADMIN_DASHBOARD_TOKEN` (sent as `x-admin-token`); keep it secret.

```bash
npm run server:demo    # real server on in-memory Postgres + stubbed internet → http://localhost:8787/admin
                       # token: demo-admin-token-0123456789 (demo only)
```

## Scheduling on a sleeping free host

Render's free tier has no cron and sleeps after 15 minutes idle, so scheduling is **durable and
sleep-tolerant**: `scheduled_tasks` rows record when each task is next due, and an external pinger
(cron-job.org) calls `POST /internal/tick` every ~15 minutes. A tick runs everything that is due, under
atomic claims, so a double call is harmless and a missed window just runs late. See [DEPLOY.md](DEPLOY.md).

| Task | Cadence | Does |
|---|---|---|
| `drain` | due every minute, so every tick (+ immediately on enqueue) | process queued fetch jobs |
| `reaper` | due every 5 min | release jobs stuck in `processing` |
| `canary` | due every 15 min | probe providers, raise alerts |
| `purge-cache` / `housekeeping` | hourly / daily 03:17 | expire caches / purge old telemetry and 30-day-expired archives |
| `reminders` | due every minute, so every tick | fire due user reminders (quiet hours 21:00–09:00 IST) |
| `resurface` | daily 04:30 UTC | the nightly resurface triggers |
| `refresh-youtube` | daily 02:23 | refresh stale YouTube stats |

## Tests

```bash
cd server && npm test    # vitest on PGlite (real SQL, real migrations) with a stubbed internet
```

Covers adapters, SSRF, ladder, caches, breaker, retries, YouTube batching, scheduler, the HTTP API and the
cross-tenant isolation matrix. They prove the logic, **not** the live providers.

## Not done / needs a decision

- **HikerAPI:** the v1 by-URL path and the comments endpoint are unverified (`HIKERAPI_V1_BY_URL_PATH`, `HIKERAPI_COMMENTS_PATH`); confirm per spec open question 3. The comments endpoint takes the media id.
- **Instagram canary** needs `CANARY_IG_SHORTCODE` (no default).
- **Frames video rung** needs ffmpeg in the image (`INSTALL_FFMPEG=true` build arg), `FFMPEG_ENABLED=true`, and the per-platform `frames_*_enabled` flag toggled from the dashboard. The thumbnails rung runs in-process. Render's free CPU/RAM is too small for video; before enabling YouTube, measure acquisition on ~100 real Shorts.
- **Anthropic Batch API** (frames rung, backfills) and prompt caching: not built; calls are synchronous. **Re-analysis on `prompt_version` bump** is not scheduled; bumping the version makes new saves re-classify and the YouTube refresh job re-run, but there is no background backfill.
- **Speech detection** (`has_speech` short-circuit): no detector without the Whisper lane, so it is not implemented; audio presence is only logged.
- **Thumbnail mirror** stores the original bytes (no ~480px webp re-encode).
- **Transient-error negative cache (5 min)** is not written; the breaker covers herd protection.
- **Place resolution** runs for `Places` **and** `Fashion` (`PLACE_RESOLUTION_CATEGORIES`) to match the app's existing store pins; the spec says Places only.
- **Per-user cap** counts a user's Nth fetch job of the UTC day; excess waits until the next UTC midnight.
- **YouTube video acquisition** is the specified stub (always `AcquireBlocked` → thumbnails). Spec open questions 1, 2, 4–7 (derived-data policy, coordinate storage, Batch pricing, quota table) still need checking against current vendor docs.
- DNS rebinding: `fetch` re-resolves the host, so the SSRF check is per hop, not IP-pinned.
- **Spend:** HikerAPI, Anthropic and Google Places are usage-billed and not covered by any free tier; daily caps default to $5 each (`BUDGET_*`). Lower them for a hard ceiling.
