# Resurface — agent / contributor guide

A smart second brain for saved content. Sits behind the share button, understands
*why* something was saved, and resurfaces it at the right moment. See
[resurface-v1-build-spec.md](resurface-v1-build-spec.md) — that spec is the
locked source of truth for V1; read it before changing behaviour.

> Expo moves fast. Read the exact versioned docs at
> https://docs.expo.dev/versions/v56.0.0/ before writing native/config code.

## Stack

- **Expo SDK 56** (managed), **expo-router** (file-based routes, typed routes on)
- **TypeScript**, strict
- **NativeWind v4** (Tailwind) for styling — theme tokens in `tailwind.config.js`
- **Supabase** — Postgres + Auth + Storage + Edge Functions + pg_cron
- Auth: Google + Apple + anonymous (guest) via Supabase Auth

## Layout

| Path | What |
|---|---|
| `app/` | expo-router routes. Groups: `(auth)`, `(onboarding)`, `(app)` |
| `app/_layout.tsx` | Providers + the auth/onboarding **routing gate** |
| `providers/AuthProvider.tsx` | Session + profile context, sign-in/out methods |
| `lib/` | `supabase.ts`, `env.ts`, `profile.ts`, `notifications.ts`, `database.types.ts` |
| `components/` | Shared UI (`Button`, `Screen`, `OnboardingScaffold`) |
| `supabase/migrations/` | SQL schema, RLS, triggers, calendar seed |

## Conventions

- Import via the `@/` alias (maps to repo root), e.g. `@/lib/supabase`.
- Client-visible env vars MUST be prefixed `EXPO_PUBLIC_`; read them through
  `lib/env.ts`, never `process.env` directly elsewhere.
- The anon key ships in the client — **RLS is the real guard**. Every new
  user-owned table needs an `auth.uid()`-scoped policy.
- Keep `lib/database.types.ts` in sync with migrations by hand (or regenerate
  with `supabase gen types`).

## Build status

Milestone 1 (auth + onboarding + data model) is implemented. Next milestones in
spec §11: capture+routing, library, resurface engine, location, spring clean.

## Commands

- `npm start` — dev server  ·  `npm run android` — run on Android
- `npm run typecheck` — `tsc --noEmit`  ·  `npx expo-doctor` — health check
