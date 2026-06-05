# Resurface — setup (Milestone 1)

This repo currently implements **Milestone 1: auth + onboarding + data model**.
The app code is wired against environment placeholders — follow these steps to
make it run live.

## 1. Install & run

```bash
npm install
npm start          # then press 'a' for Android, or scan the QR in Expo Go
```

> Sign-in (Google/Apple) and push tokens need a **dev build**, not Expo Go,
> because they use native modules + a custom URL scheme. Guest sign-in and the
> onboarding UI work in Expo Go once Supabase env vars are set. To make a dev
> build: `npx expo run:android` (needs Android Studio) or EAS Build.

## 2. Supabase project

1. Create a project at https://supabase.com.
2. Apply the migrations in `supabase/migrations/` (in filename order). Either:
   - **Dashboard:** paste each file into SQL Editor and run, in order; **or**
   - **CLI:** `npx supabase link --project-ref <ref>` then `npx supabase db push`.
3. Grab the project URL and `anon` key from **Project Settings → API**.

## 3. Environment

```bash
cp .env.example .env
```

Fill in:

- `EXPO_PUBLIC_SUPABASE_URL` — your project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — the anon/public key
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` — once Google auth is configured (step 4)
- `EXPO_PUBLIC_EAS_PROJECT_ID` — after `eas init` (needed for push tokens)

`lib/env.ts` throws on launch if the Supabase vars are missing, so this is a
hard requirement before the app boots.

## 4. Auth providers (Supabase Dashboard → Authentication)

- **Anonymous (guest):** Providers → enable **Anonymous sign-ins**. (Powers the
  "Just start saving" button.)
- **Google:** Providers → Google → enable, paste your Google OAuth client
  credentials. Add the redirect URL Supabase shows you to the Google console.
- **Apple:** Providers → Apple → enable (Apple sign-in only renders on iOS).
- **Redirect / deep link:** the app uses the `resurface://` scheme
  (`app.json` → `scheme`). Add it under **URL Configuration → Redirect URLs** as
  `resurface://*` so the OAuth flow can return to the app.

A `public.users` profile row is created automatically on every signup by the
`on_auth_user_created` trigger (`supabase/migrations/...triggers.sql`).

## 5. Push notifications

- Run `eas init` to get a project id; put it in `EXPO_PUBLIC_EAS_PROJECT_ID`.
- Push tokens only mint on a **physical device** with a dev/standalone build —
  the onboarding flow registers the Expo push token after permission is granted
  and on app launch (`lib/notifications.ts`). It no-ops on emulators.

## What's deferred (by spec, not missing)

- **Google Places Autocomplete** for home city + Places location — needs a
  billing account; home city is a plain text input for now (spec §6.3, §7).
- **Location permission** is intentionally NOT requested at onboarding — it's a
  contextual in-app prompt after 3 Places saves (spec §6, Milestone 5).
- Calendar seed dates are a hand-curated starter set — verify before production
  (`supabase/migrations/...seed_calendar.sql`).

## Verify

```bash
npm run typecheck     # tsc --noEmit
npx expo-doctor       # 21/21 checks
```
