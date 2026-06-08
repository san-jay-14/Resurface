-- V2: Soft-deleted saves from Self-Cleaning swipe mode
create table if not exists public.archived_saves (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  original_save_id uuid not null,
  original_data    jsonb not null,
  archived_at      timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '30 days'
);

create index if not exists archived_saves_user_idx
  on public.archived_saves (user_id, archived_at desc);
create index if not exists archived_saves_expires_idx
  on public.archived_saves (expires_at);
