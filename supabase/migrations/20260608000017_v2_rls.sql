-- V2: Row Level Security for all new tables

-- user_rules
alter table public.user_rules enable row level security;
create policy "user_rules_own" on public.user_rules
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- archived_saves
alter table public.archived_saves enable row level security;
create policy "archived_saves_own" on public.archived_saves
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- wrapped_history
alter table public.wrapped_history enable row level security;
create policy "wrapped_history_own" on public.wrapped_history
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- collection_members: members can see all rows for boards they belong to
alter table public.collection_members enable row level security;
create policy "collection_members_own" on public.collection_members
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "collection_members_view_board" on public.collection_members
  for select using (
    collection_id in (
      select collection_id from public.collection_members cm
      where cm.user_id = auth.uid()
    )
  );

-- collection_save_reactions: visible to all board members
alter table public.collection_save_reactions enable row level security;
create policy "collection_reactions_own" on public.collection_save_reactions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "collection_reactions_view_board" on public.collection_save_reactions
  for select using (
    collection_id in (
      select collection_id from public.collection_members cm
      where cm.user_id = auth.uid()
    )
  );
