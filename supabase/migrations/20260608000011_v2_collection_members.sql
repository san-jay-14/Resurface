-- V2: Board / collection membership for shared boards
create table if not exists public.collection_members (
  id          uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member', -- 'owner' | 'member'
  joined_at   timestamptz not null default now(),
  unique(collection_id, user_id)
);

create index if not exists collection_members_user_idx
  on public.collection_members (user_id);
create index if not exists collection_members_col_idx
  on public.collection_members (collection_id);
