-- V2: Add last_viewed_at to saves + expand source_platform enum
alter table public.saves
  add column if not exists last_viewed_at timestamptz;

-- Expand platform enum with new V2 platforms
alter type source_platform add value if not exists 'tiktok';
alter type source_platform add value if not exists 'pinterest';
alter type source_platform add value if not exists 'twitter';
alter type source_platform add value if not exists 'linkedin';

create index if not exists saves_dormant_idx on public.saves (user_id, created_at)
  where archived = false and acted_on = false;
