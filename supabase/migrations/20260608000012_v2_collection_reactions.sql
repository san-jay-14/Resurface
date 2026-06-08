-- V2: "I'm in" / "Pass" reactions on saves within a shared board
create table if not exists public.collection_save_reactions (
  id            uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  save_id       uuid not null references public.saves(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  reaction      text not null default 'in', -- 'in' | 'pass'
  created_at    timestamptz not null default now(),
  unique(collection_id, save_id, user_id)
);

create index if not exists collection_reactions_save_idx
  on public.collection_save_reactions (collection_id, save_id);
