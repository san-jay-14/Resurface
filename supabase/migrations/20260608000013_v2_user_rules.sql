-- V2: AI categorisation rules per user
create table if not exists public.user_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  raw_text     text not null,
  parsed_logic jsonb not null,
  is_active    boolean not null default true,
  priority     int not null default 0,
  hit_count    int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_user_rules_user_active
  on public.user_rules (user_id, is_active);
