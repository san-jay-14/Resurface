-- Core application schema (plain Postgres; authorization lives in the API, not RLS).
-- Enumerations are text + CHECK rather than enum types: adding a value is a constraint swap, not
-- an ALTER TYPE that cannot run inside a transaction.

create function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- users: application profile, 1:1 with the Better Auth identity
-- ---------------------------------------------------------------------------
create table users (
  id                       uuid primary key references "user" (id) on delete cascade,
  name                     text,
  email                    text,
  avatar_url               text,
  birthday                 date,
  home_city                text,
  home_city_lat            double precision,
  home_city_lng            double precision,
  current_city             text,
  current_city_lat         double precision,
  current_city_lng         double precision,
  current_city_updated_at  timestamptz,
  onboarding_completed     boolean not null default false,
  wrapped_theme            text,
  feature_flags            jsonb not null default
    '{"ai_rules_enabled":true,"cleanup_mode_enabled":true,"wrapped_enabled":true,"shared_boards_enabled":true}',
  notification_prefs       jsonb not null default
    '{"new_city":true,"birthday":true,"long_weekend":true,"frequency":"normal"}',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index users_current_city_idx on users (current_city) where current_city is not null;
create trigger users_touch before update on users for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- user_sub_categories (referenced by saves)
-- ---------------------------------------------------------------------------
create table user_sub_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  category    text not null,
  name        text not null,
  emoji       text not null default '📁',
  created_at  timestamptz not null default now()
);
create index user_sub_categories_user_cat_idx on user_sub_categories (user_id, category);

-- ---------------------------------------------------------------------------
-- saves
--   source_platform : where the user found it (UI-facing, includes platforms with no adapter)
--   platform/content_id : adapter identity used by the enrichment pipeline
-- ---------------------------------------------------------------------------
create table saves (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references users (id) on delete cascade,
  source_platform      text not null check (source_platform in
    ('instagram','web','youtube','whatsapp','tiktok','pinterest','twitter','linkedin','unsorted')),
  source_url           text,
  platform             text,
  content_id           text,
  category             text not null default 'unsorted' check (category in
    ('places','recipes','fashion','shopping','watch_learn','inspo','unsorted')),
  title                text,
  note                 text,
  caption              text,
  ai_description       text,
  keywords             text[],
  thumbnail_url        text,
  source_username      text,
  status               text not null default 'pending' check (status in ('pending','enriched','manual')),
  enrichment_status    text check (enrichment_status in ('queued','processing','done','needs_review')),
  enrichment_reason    text,
  enriched_at          timestamptz,
  scrape_method        text not null default 'manual',
  category_confidence  numeric(4,3),
  acted_on             boolean not null default false,
  acted_on_at          timestamptz,
  is_favorite          boolean not null default false,
  archived             boolean not null default false,
  archived_at          timestamptz,
  last_viewed_at       timestamptz,
  last_interacted_at   timestamptz,
  remind_at            timestamptz,
  reminded_at          timestamptz,
  sub_category_id      uuid references user_sub_categories (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- NULL content_id (manual saves) never collides: NULLs are distinct.
  constraint saves_user_platform_content_key unique (user_id, platform, content_id)
);
create index saves_user_created_idx   on saves (user_id, created_at desc);
create index saves_user_category_idx  on saves (user_id, category);
create index saves_user_live_idx      on saves (user_id) where archived = false;
create index saves_resurface_idx      on saves (user_id, category) where archived = false and acted_on = false;
create index saves_updated_idx        on saves (user_id, updated_at);
create index saves_post_idx           on saves (platform, content_id) where content_id is not null;
create index saves_sub_category_idx   on saves (sub_category_id);
create index saves_remind_idx         on saves (remind_at) where remind_at is not null and reminded_at is null;
create index saves_fts_idx on saves using gin (
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(ai_description, '') || ' ' || coalesce(note, '')));
create trigger saves_touch before update on saves for each row execute function touch_updated_at();

create table save_locations (
  id               uuid primary key default gen_random_uuid(),
  save_id          uuid not null unique references saves (id) on delete cascade,
  place_name       text,
  lat              double precision,
  lng              double precision,
  city             text,
  country          text,
  google_place_id  text,
  created_at       timestamptz not null default now()
);
create index save_locations_city_idx on save_locations (lower(city));

-- ---------------------------------------------------------------------------
-- boards (collections), sharing, reactions
-- ---------------------------------------------------------------------------
create table collections (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references users (id) on delete cascade,
  name               text not null,
  description        text,
  requires_location  boolean not null default false,
  source_category    text,
  is_shared          boolean not null default false,
  invite_code        text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index collections_owner_name_idx on collections (owner_id, lower(name));
create unique index collections_owner_source_category_idx on collections (owner_id, source_category)
  where source_category is not null;
create trigger collections_touch before update on collections for each row execute function touch_updated_at();

create table collection_saves (
  collection_id  uuid not null references collections (id) on delete cascade,
  save_id        uuid not null references saves (id) on delete cascade,
  added_at       timestamptz not null default now(),
  primary key (collection_id, save_id)
);
create index collection_saves_save_idx on collection_saves (save_id);

create table collection_members (
  collection_id  uuid not null references collections (id) on delete cascade,
  user_id        uuid not null references users (id) on delete cascade,
  role           text not null default 'member' check (role in ('owner','member')),
  joined_at      timestamptz not null default now(),
  primary key (collection_id, user_id)
);
create index collection_members_user_idx on collection_members (user_id);

create table collection_save_reactions (
  collection_id  uuid not null references collections (id) on delete cascade,
  save_id        uuid not null references saves (id) on delete cascade,
  user_id        uuid not null references users (id) on delete cascade,
  reaction       text not null check (reaction in ('in','pass')),
  created_at     timestamptz not null default now(),
  primary key (collection_id, save_id, user_id)
);

-- ---------------------------------------------------------------------------
-- rules, archive, wrapped, reports
-- ---------------------------------------------------------------------------
create table user_rules (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users (id) on delete cascade,
  raw_text       text not null,
  parsed_logic   jsonb not null,
  is_active      boolean not null default true,
  priority       integer not null default 0,
  hit_count      integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index user_rules_user_active_idx on user_rules (user_id, is_active);
create trigger user_rules_touch before update on user_rules for each row execute function touch_updated_at();

create table archived_saves (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users (id) on delete cascade,
  original_save_id  uuid not null,
  original_data     jsonb not null,
  archived_at       timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '30 days'
);
create index archived_saves_user_idx on archived_saves (user_id, archived_at desc);
create index archived_saves_expires_idx on archived_saves (expires_at);

create table wrapped_history (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users (id) on delete cascade,
  period_start    date not null,
  period_end      date not null default (now() at time zone 'utc')::date,
  stats_snapshot  jsonb not null,
  copy            jsonb not null,
  created_at      timestamptz not null default now()
);
create index wrapped_history_user_idx on wrapped_history (user_id, created_at desc);

create table bug_reports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  message      text not null,
  attachments  text[] not null default '{}',   -- object-storage keys (private)
  status       text not null default 'open',
  created_at   timestamptz not null default now()
);
create index bug_reports_user_idx on bug_reports (user_id);

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create table device_tokens (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users (id) on delete cascade,
  expo_push_token  text not null unique,
  platform         text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index device_tokens_user_idx on device_tokens (user_id);
create trigger device_tokens_touch before update on device_tokens for each row execute function touch_updated_at();

create table notification_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  save_ids      uuid[] not null default '{}',
  trigger_type  text not null,
  copy          text,
  sent_at       timestamptz not null default now(),
  tapped        boolean not null default false
);
create index notification_log_user_idx on notification_log (user_id, sent_at desc);

create table calendar_events (
  id      uuid primary key default gen_random_uuid(),
  name    text not null,
  type    text not null check (type in ('holiday','festival','long_weekend')),
  date    date not null,
  region  text not null default 'IN',
  unique (name, date, region)
);
create index calendar_events_date_idx on calendar_events (date);

-- ---------------------------------------------------------------------------
-- share tokens: narrowly-scoped, revocable credential for the Android share worker.
-- Only the SHA-256 of the token is stored.
-- ---------------------------------------------------------------------------
create table share_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  token_hash    text not null unique,
  label         text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index share_tokens_user_idx on share_tokens (user_id) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- durable scheduler state (replaces pg_cron). Definitions live in code.
-- ---------------------------------------------------------------------------
create table scheduled_tasks (
  name          text primary key,
  next_run_at   timestamptz not null,
  last_run_at   timestamptz,
  last_status   text,
  last_error    text,
  locked_until  timestamptz,
  run_count     integer not null default 0
);
