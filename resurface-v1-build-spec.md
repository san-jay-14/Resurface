# Resurface — V1 Build Spec

> A smart second brain for saved content. It sits behind the share button, understands *why* something was saved, and brings it back at the right moment — when you're near that café, the week before your birthday, the evening before a long weekend. It does not replace Instagram saves; it makes them useful.

This document is the locked decision set for building V1. It is written to be handed to Claude Code as a build brief. Every decision here is final for V1 unless explicitly marked as deferred.

---

## 1. Target user & platform

- **Audience:** Gen Z, 18–26, India, metro / English-first (start with users like the founder: heavy savers of travel, food, fashion, product content).
- **Platform:** **Android first.** Design and build for Android as the primary target. Keep architecture portable to iOS later, but do not optimize for iOS in V1.
- **Monetization:** **Free in V1.** Design the data model so a paywall can be added later, but build no billing now. The goal of V1 is validating the core loop, not revenue.

**The core loop V1 must prove:** `Save → Categorise → Resurface at the right moment.`

**Guiding principle:** the first genuine "how did it know?" resurface should happen within the user's first 48 hours, or they won't come back.

---

## 2. V1 scope

### In V1
- Share-sheet capture from Instagram, web/browser, YouTube/Shorts, WhatsApp links
- Manual category + location popup for Instagram (and any shared media with no URL)
- Automatic categorisation for URL-based saves
- Visual library
- Resurface notifications: new-city, long-weekend, birthday triggers
- In-app "spring clean" for stale saves
- Onboarding with deferred location permission

### Explicitly OUT of V1 (deferred to V2+)
- Resurface Wrapped (personality cards)
- AI plain-English rules engine
- Social / shared boards
- Instagram scraping (no scraper dependency at all in V1)
- Geofencing / hyper-local "you're 200m away" resurface
- Multi-model AI cost routing
- Pinterest, X/Twitter, LinkedIn capture
- Snapchat, Moj/Josh, Telegram (dropped entirely — not planned)
- Paywall / billing

---

## 3. Capture layer

### 3.1 Platforms & paths (locked)

| Platform | Path | Phase |
|---|---|---|
| Instagram (reels/posts) | Manual — category + location popup | V1 |
| Generic web / browser URL | Auto | V1 |
| YouTube + Shorts | Auto | V1 |
| WhatsApp-forwarded link | Auto (if URL) / Manual (if media file) | V1 |
| Pinterest | Auto | V2 |
| X / Twitter | Auto | V2 |
| LinkedIn | Auto | V2 |

### 3.2 Routing logic (the whole branch)

On every share received by the app:

1. **Is there a readable URL in the share payload?**
   - **Yes** → Auto path (fetch metadata → AI classify → store).
   - **No** (Instagram, or WhatsApp media file with no link) → Manual path (show category + location popup).

The app receives shares via the Android share intent (`ACTION_SEND`, `text/*` and media types). It does not integrate per-app APIs — it reacts to whatever any app hands the share sheet. "Instagram support" means handling the URL Instagram passes; "web support" means handling any URL from the browser.

### 3.3 Manual popup (Instagram + media-with-no-URL)

- **Step 1 — Category:** one-tap chip selection (required). See §4.
- **Step 2 — Location:** a location field that appears **only** when the chosen category is **Places** (and optionally **Shopping**). Hidden for all other categories, so most saves are a single tap. Use Google Places Autocomplete so location is tap-and-pick, not free typing.
- **Intent / note is NOT collected in the popup.** It is added later, inside the app, framed as something like "add why you saved this — it improves your resurfaces." This keeps the save fast and turns intent into a reason to return to the app.
- **Escape hatch:** a "Just save it" option drops the save into an **Unsorted** bucket and dismisses instantly. Protects compulsive-save behaviour; user can sort later. Track usage — heavy use signals the taxonomy needs rethinking.

### 3.4 Auto path (URL-based saves)

1. Receive URL → detect platform from the URL.
2. Fetch metadata:
   - **YouTube/Shorts:** YouTube Data API v3 (full title, description, tags, thumbnail). Free tier (10k units/day).
   - **Web / WhatsApp links / others:** fetch Open Graph tags (`og:title`, `og:description`, `og:image`, `og:type`) via an HTML parser (e.g. cheerio).
3. AI classification (vision + available text) → `{ category, confidence, location_hints[], keywords[], description }`. Structured JSON output.
4. Geocode any `location_hints` via Google Geocoding → `{ lat, lng, city, country, place_id }`. Store in `save_locations`.
5. **Re-host the thumbnail** to Supabase Storage immediately (platform CDN links expire). Store the storage URL on the save.
6. Store the enriched save.

> Note: There is no Instagram caption/thumbnail available via any legitimate API (oEmbed deprecated Oct 2025; no personal-account Graph API). This is *why* Instagram is on the manual path. Do not build a scraper in V1.

---

## 4. Categories (locked — 6 chips, no sub-categories in V1)

| Chip | Covers | Resurfaces via | Location field |
|---|---|---|---|
| Places | cafés, restaurants, bars, travel spots — anything you *go to* | location, long weekends | **Yes** |
| Recipes | food to cook at home | festivals, weekend cooking (V2) | No |
| Fashion | outfits, styling | birthday, festivals, season (V2) | No |
| Shopping | products to buy | want/occasion (sales = V2) | Optional |
| Watch / Learn | tutorials, how-tos, content to consume | free-time, weekend evenings (V2) | No |
| Inspo | aesthetic, mood, no clear action | low priority; Wrapped fodder (V2) | No |

**Critical rule:** "Places" and "Recipes" are separate even though both are food. A café you visit is a *place* (has a location, resurfaces by proximity / long weekend). A recipe is *not* a place (no location, resurfaces by occasion). Never merge them into a single "Food" bucket — doing so breaks the location feature for half of food saves.

---

## 5. Resurface engine

### 5.1 Triggers

| Trigger | Fires when | Matches | Phase |
|---|---|---|---|
| New city | user enters a city ≠ home | Places in that city, un-acted | V1 |
| Long weekend | a holiday makes a 3-day weekend, ~3 days out | Places (getaways), un-acted | V1 |
| Birthday | user's birthday, ~8 days out | Fashion, Places | V1 |
| Spring clean | saves untouched 60+ days | any stale saves | V1 (in-app only) |
| Festival | Diwali/Holi/Eid etc., ~7 days out | Fashion, Recipes, Places | V1.1 |
| Home weekend | Sat/Sun in home city | nearby Places | V1.1 |
| Seasonal shift | monsoon/summer onset | season-relevant Places, Fashion | V2 |
| Weekend watchlist | Fri/Sat evening, watch saves piling up | Watch/Learn | V2 |

All V1 triggers work at **city level** — no geofencing required (lower battery, cheaper). Hyper-local proximity is V2.

### 5.2 Notification guard pipeline (every candidate passes through, in order)

A candidate notification is generated by a trigger, then must clear all gates before it fires:

1. **Relevance** — at least one matching, un-acted-on save exists. (Cheapest check first.)
2. **Throttle** — user is under the cap (max **2 notifications/week**) AND it has been **≥3 days** since the last notification.
3. **Freshness** — these specific saves were not resurfaced in the last **30 days**.
4. **Timing** — current local time is outside quiet hours (**quiet hours = 9pm–9am local**); if inside, defer to the next good slot.

If all gates pass: **the AI writes the notification copy (this happens last, only after gates pass), then send via Expo Push.** If any gate fails: no notification.

- **Priority when multiple candidates compete for the one weekly slot:** location > occasion > behavioral. The new-city trigger is highest value but, for V1, **stays inside the shared 2/week cap** (revisit only if testing shows we're missing great moments).
- **Copy tone:** like a friend texting, not an algorithm pinging. Generated per-save with real context, never templated. Example: *"You saved a rooftop bar here 3 weeks ago. Still want to go?"*

### 5.3 "Acted on" definition

A save is "acted on" when the user: taps through it from a notification, opens it in-app, OR manually marks it done. Once acted on, it stops being eligible for resurfacing. (This flag also feeds the V2 Wrapped feature — "94 saved, 7 acted on" — so build it now.)

### 5.4 Spring clean

In-app prompt only (never a push). Surfaced ~monthly. Shows saves untouched 60+ days in a swipe UI: right = keep (resets resurface eligibility), left = soft-delete (archived, recoverable 30 days). Designed as a <60-second task with light gamification ("you cleared 8 saves").

---

## 6. Onboarding & permissions

Order matters. Keep it short — no tutorial walls.

1. **Auth:** Google + Apple sign-in (no passwords). Plus a **guest mode** so users can save before creating an account.
2. **Birthday:** asked once, with a clear reason ("so I can remind you of saved outfits before it"). Used by the birthday trigger.
3. **Home city:** asked once at onboarding (required for the new-city trigger). Auto-update if the user spends >2 weeks elsewhere.
4. **Notification permission:** show a value-explaining pre-prompt screen *before* triggering the OS dialog.
5. **Share target setup:** brief visual guide showing how to share into Resurface.
6. **Push token:** register the Expo push token against the user's account on first launch.

**Location permission is NOT requested at onboarding.** Defer it to a contextual in-app prompt shown *after the user saves 3+ Places* ("You've saved 3 places to visit. Want me to remind you when you're nearby?"). This converts far better and is required before any location trigger can work.

---

## 7. Tech stack (locked)

| Layer | Choice | Notes |
|---|---|---|
| App framework | **Expo** (managed workflow) | Android-first |
| Share capture | **expo-share-intent** | Media-with-no-URL routes to the manual popup |
| Backend | **Supabase** | Postgres + Auth + Storage + Edge Functions + pg_cron — one platform |
| Auth | **Supabase Auth** | Google + Apple providers; guest sessions |
| Database | **PostgreSQL** (via Supabase) | PostGIS optional for geo queries |
| AI | **Single provider, structured JSON output** | V1 keeps it simple (no multi-model routing). Used for classification, location extraction, notification copy. Routing to a cheaper vision model is a V2 scale optimization. |
| Push | **Expo Push** | Free, abstracts FCM/APNs; trigger logic stays server-side |
| Location | **expo-location** (city-level) | `react-native-background-geolocation` deferred to V2 (geofencing). Saves the paid Android license during validation. |
| Geocoding / autocomplete | **Google Places Autocomplete + Geocoding** | Powers the Places location field. **Requires a billing account.** |
| Metadata (YouTube) | **YouTube Data API v3** | Free tier sufficient |
| Metadata (web/links) | **Open Graph scraping** (cheerio or similar) | Richest, most reliable signal |
| Storage | **Supabase Storage** | Re-host all thumbnails (CDN links expire) |
| Scheduling | **pg_cron + a jobs table** | No Redis in V1; add at scale |
| Instagram data | **None** | No scraper in V1 — manual path only |

---

## 8. Proposed data model

Field-level sketch for Claude Code to refine into migrations.

**users**
- `id` (pk), auth provider id, `name`
- `birthday` (date)
- `home_city`, `home_city_lat`, `home_city_lng`
- `notif_frequency_pref` (default: weekly), `last_notified_at`
- `is_guest` (bool), `created_at`

**saves**
- `id` (pk), `user_id` (fk)
- `source_platform` (instagram | web | youtube | whatsapp | unsorted)
- `source_url` (nullable — null for manual media saves)
- `category` (places | recipes | fashion | shopping | watch_learn | inspo | unsorted)
- `note` (nullable — added later in-app)
- `thumbnail_url` (nullable — Supabase Storage URL; null for note-only IG saves)
- `ai_description` (nullable), `keywords` (nullable array)
- `status` (pending | enriched | manual)
- `acted_on` (bool, default false)
- `archived` (bool, default false), `archived_at` (nullable)
- `created_at`, `last_interacted_at`

**save_locations**
- `save_id` (fk), `place_name`, `lat`, `lng`, `city`, `country`, `google_place_id`

**user_events**
- `user_id` (fk), `type` (birthday | anniversary | trip), `date`

**calendar_events** (global, seeded — hand-curated Indian holidays/festivals/long-weekends; refresh annually)
- `name`, `type` (holiday | festival | long_weekend), `date`, `region`

**device_tokens**
- `user_id` (fk), `expo_push_token`, `platform`

**notification_log**
- `user_id` (fk), `save_ids` (array), `trigger_type`, `copy`, `sent_at`, `tapped` (bool)

---

## 9. Design direction

- **Android-first.** Material-friendly but with personality.
- **Vibe:** clean, warm, Gen-Z-friendly. Personality lives in the copy (notifications, empty states, onboarding) — not corporate.
- **Name:** "Resurface" (working title — validate with users later).
- **Library:** scrollable grid of save cards — thumbnail, category pill, AI/user description, time since saved. Filters: All, Places, Recipes, Fashion, Shopping, Watch/Learn, Inspo, Unsorted.
- **The no-thumbnail card:** a manual Instagram save may have no image at all. Render a deliberate **text card** (category icon + the user's note + location + a source badge), not a broken-image placeholder. Make text cards look intentional.
- **Design principles:** feel like content, not a task; earn location permission, don't demand it; notifications must sound like a friend; humour is a feature; first "wow" within 48 hours.

---

## 10. Known constraints & risks to carry into the build

- **Instagram metadata is unavailable** via any legitimate API (oEmbed deprecated Oct 2025; no personal-account API). This is the reason for the manual path. Accept it; do not build a scraper.
- **Thumbnail CDN links expire** — always re-host to Supabase Storage on save.
- **Notification discipline is existential.** Over-notification kills apps like this. The guard pipeline is not optional polish — it is the product.
- **Android share intent** is the capture mechanism (no Instagram permission needed). If/when iOS is added later, the iOS share extension has a ~30MB memory cap and must be a thin "data courier" (capture URL → hand off → dismiss; no heavy logic in the extension).
- **Google Places/Geocoding needs a billing account** — provision before the Places location field works.

---

## 11. Suggested build order (first milestones)

1. **Auth + onboarding + data model** — get users in, capture birthday + home city, register push token.
2. **Capture + routing** — share intent in; branch on URL-present; manual popup (category chips + conditional Places location); auto path for web + YouTube.
3. **Library** — grid + filters; text-card rendering for no-thumbnail saves; mark-as-acted-on.
4. **Resurface engine** — calendar triggers (long-weekend, birthday) first (no permission needed), then the guard pipeline, then Expo Push delivery.
5. **Location** — contextual permission after 3 Places saves; expo-location city detection; new-city trigger.
6. **Spring clean** — in-app stale-save sweep.

Calendar triggers ship before location triggers because they need no extra permission and can deliver the first "wow" fastest.

---

*Decisions locked from the product ideation sessions. Hand to Claude Code as the V1 build brief.*
