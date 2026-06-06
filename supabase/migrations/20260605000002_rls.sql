-- Row Level Security. The anon key ships in the client, so RLS is the real guard.
-- Rule of thumb: a user can only ever touch rows scoped to their own auth.uid().

alter table public.users           enable row level security;
alter table public.saves           enable row level security;
alter table public.save_locations  enable row level security;
alter table public.user_events     enable row level security;
alter table public.calendar_events enable row level security;
alter table public.device_tokens   enable row level security;
alter table public.notification_log enable row level security;

-- ---- users -----------------------------------------------------------------
create policy "users read own profile"
  on public.users for select using (auth.uid() = id);
create policy "users update own profile"
  on public.users for update using (auth.uid() = id) with check (auth.uid() = id);
-- INSERT via trigger on signup; also allowed from client as a fallback so that
-- users who signed up before migrations were applied can still create their row.
create policy "users insert own profile"
  on public.users for insert with check (auth.uid() = id);

-- ---- saves -----------------------------------------------------------------
create policy "saves owner all"
  on public.saves for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---- save_locations --------------------------------------------------------
-- Ownership is derived through the parent save.
create policy "save_locations owner all"
  on public.save_locations for all
  using (exists (
    select 1 from public.saves s
    where s.id = save_locations.save_id and s.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.saves s
    where s.id = save_locations.save_id and s.user_id = auth.uid()
  ));

-- ---- user_events -----------------------------------------------------------
create policy "user_events owner all"
  on public.user_events for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---- calendar_events -------------------------------------------------------
-- Global, read-only for any signed-in user. Writes only via service role
-- (service role bypasses RLS, so no write policy is defined).
create policy "calendar_events read all"
  on public.calendar_events for select
  to authenticated
  using (true);

-- ---- device_tokens ---------------------------------------------------------
create policy "device_tokens owner all"
  on public.device_tokens for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---- notification_log ------------------------------------------------------
-- Users may read their own log (and update `tapped`); rows are created server-side.
create policy "notification_log read own"
  on public.notification_log for select using (auth.uid() = user_id);
create policy "notification_log update own"
  on public.notification_log for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
