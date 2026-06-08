-- V2: Add shared-board fields to collections
alter table public.collections
  add column if not exists is_shared  boolean  not null default false,
  add column if not exists invite_code text unique,
  add column if not exists owner_id   uuid references auth.users(id);

-- Backfill owner_id from user_id for existing rows
update public.collections set owner_id = user_id where owner_id is null;

create index if not exists collections_invite_code_idx on public.collections (invite_code)
  where invite_code is not null;
