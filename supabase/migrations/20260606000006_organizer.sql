-- Phase 3: Saves Organizer Enhancement
-- Extends saves with organizer fields; adds collections + collection_saves tables.

-- 1. New columns on saves
alter table public.saves
  add column if not exists title           text,
  add column if not exists acted_on_at     timestamptz,
  add column if not exists is_favorite     boolean not null default false;

-- 2. Full-text search index over title + ai_description + note
create index if not exists saves_fts_idx on public.saves
  using gin (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(ai_description, '') || ' ' ||
      coalesce(note, '')
    )
  );

-- 3. Filter-optimised indexes
create index if not exists saves_user_acted_idx on public.saves (user_id, acted_on);
create index if not exists saves_user_fav_idx   on public.saves (user_id, is_favorite);

-- 4. Collections (user-created boards — flat, no nesting)
create table if not exists public.collections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Case-insensitive uniqueness per user
create unique index if not exists collections_user_name_idx
  on public.collections (user_id, lower(name));

create index if not exists collections_user_idx on public.collections (user_id);

-- 5. Collection ↔ Save junction (many-to-many)
create table if not exists public.collection_saves (
  collection_id uuid not null references public.collections (id) on delete cascade,
  save_id       uuid not null references public.saves (id) on delete cascade,
  added_at      timestamptz not null default now(),
  primary key (collection_id, save_id)
);

create index if not exists collection_saves_save_idx on public.collection_saves (save_id);

-- 6. RLS
alter table public.collections      enable row level security;
alter table public.collection_saves enable row level security;

create policy "users manage own collections"
  on public.collections for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users manage own collection_saves"
  on public.collection_saves for all
  using (
    exists (
      select 1 from public.collections c
      where c.id = collection_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.collections c
      where c.id = collection_id and c.user_id = auth.uid()
    )
  );
