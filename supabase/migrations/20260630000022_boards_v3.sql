-- V3: Richer board creation (description + location-marking), category-board
-- sharing (shadow collections), and per-save reminder dates.

-- 1. Collections: description + location-marking + category-share linkage
alter table public.collections
  add column if not exists description       text,
  add column if not exists requires_location boolean not null default false,
  add column if not exists source_category   text;

-- A user can have at most one "shadow" shared collection per category
-- (created the first time they share a built-in category board).
create unique index if not exists collections_user_source_category_idx
  on public.collections (user_id, source_category)
  where source_category is not null;

-- 2. Saves: optional user-set reminder date ("remind me about this on X")
alter table public.saves
  add column if not exists remind_at   timestamptz,
  add column if not exists reminded_at timestamptz;

create index if not exists saves_remind_at_idx on public.saves (remind_at)
  where remind_at is not null and reminded_at is null;
