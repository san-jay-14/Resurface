-- Resurface V1 — core schema
-- Field-level model from build spec §8, refined into Postgres types.

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- Enums (locked taxonomy from spec §3 & §4)
-- ----------------------------------------------------------------------------
create type source_platform as enum ('instagram', 'web', 'youtube', 'whatsapp', 'unsorted');
create type save_category as enum ('places', 'recipes', 'fashion', 'shopping', 'watch_learn', 'inspo', 'unsorted');
create type save_status as enum ('pending', 'enriched', 'manual');
create type user_event_type as enum ('birthday', 'anniversary', 'trip');
create type calendar_event_type as enum ('holiday', 'festival', 'long_weekend');

-- ----------------------------------------------------------------------------
-- users — profile row, 1:1 with auth.users (populated by trigger on signup)
-- ----------------------------------------------------------------------------
create table public.users (
  id                   uuid primary key references auth.users (id) on delete cascade,
  name                 text,
  email                text,
  birthday             date,
  home_city            text,
  home_city_lat        double precision,
  home_city_lng        double precision,
  notif_frequency_pref text not null default 'weekly',
  last_notified_at     timestamptz,
  is_guest             boolean not null default false,
  -- Routing flag: drives whether the app sends a returning user to onboarding.
  onboarding_completed boolean not null default false,
  created_at           timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- saves — the captured content
-- ----------------------------------------------------------------------------
create table public.saves (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users (id) on delete cascade,
  source_platform    source_platform not null,
  source_url         text,                 -- null for manual media saves
  category           save_category not null,
  note               text,                 -- added later, in-app ("why you saved this")
  thumbnail_url      text,                 -- Supabase Storage URL; null for text-only IG saves
  ai_description     text,
  keywords           text[],
  status             save_status not null default 'pending',
  acted_on           boolean not null default false,
  archived           boolean not null default false,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  last_interacted_at timestamptz
);

create index saves_user_idx on public.saves (user_id);
create index saves_user_category_idx on public.saves (user_id, category);
-- Partial index: the library and resurface engine mostly query live (non-archived) saves.
create index saves_user_live_idx on public.saves (user_id) where archived = false;
-- Resurface eligibility lookups: live, un-acted-on saves.
create index saves_resurface_idx on public.saves (user_id, category)
  where archived = false and acted_on = false;

-- ----------------------------------------------------------------------------
-- save_locations — geocoded location for a save (Places, optionally Shopping)
-- One location per save in V1.
-- ----------------------------------------------------------------------------
create table public.save_locations (
  id              uuid primary key default gen_random_uuid(),
  save_id         uuid not null unique references public.saves (id) on delete cascade,
  place_name      text,
  lat             double precision,
  lng             double precision,
  city            text,
  country         text,
  google_place_id text,
  created_at      timestamptz not null default now()
);

create index save_locations_city_idx on public.save_locations (city);

-- ----------------------------------------------------------------------------
-- user_events — per-user dated events (birthday is also denormalised on users)
-- ----------------------------------------------------------------------------
create table public.user_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  type       user_event_type not null,
  date       date not null,
  created_at timestamptz not null default now()
);

create index user_events_user_idx on public.user_events (user_id);

-- ----------------------------------------------------------------------------
-- calendar_events — global, seeded (hand-curated Indian holidays/festivals)
-- No user_id. Readable by all; written only via service role.
-- ----------------------------------------------------------------------------
create table public.calendar_events (
  id     uuid primary key default gen_random_uuid(),
  name   text not null,
  type   calendar_event_type not null,
  date   date not null,
  region text not null default 'IN'
);

create index calendar_events_date_idx on public.calendar_events (date);

-- ----------------------------------------------------------------------------
-- device_tokens — Expo push tokens per device
-- ----------------------------------------------------------------------------
create table public.device_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,
  expo_push_token text not null unique,
  platform        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index device_tokens_user_idx on public.device_tokens (user_id);

-- ----------------------------------------------------------------------------
-- notification_log — every fired notification (feeds throttle + freshness gates)
-- ----------------------------------------------------------------------------
create table public.notification_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  save_ids     uuid[] not null default '{}',
  trigger_type text not null,
  copy         text,
  sent_at      timestamptz not null default now(),
  tapped       boolean not null default false
);

create index notification_log_user_idx on public.notification_log (user_id, sent_at desc);
