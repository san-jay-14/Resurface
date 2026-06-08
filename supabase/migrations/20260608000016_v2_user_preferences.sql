-- V2: Extend users table with preference fields
alter table public.users
  add column if not exists wrapped_theme   text,
  add column if not exists feature_flags   jsonb not null default '{
    "ai_rules_enabled": true,
    "cleanup_mode_enabled": true,
    "wrapped_enabled": true,
    "shared_boards_enabled": true
  }'::jsonb,
  add column if not exists current_city        text,
  add column if not exists current_city_lat    double precision,
  add column if not exists current_city_lng    double precision,
  add column if not exists current_city_updated_at timestamptz;
