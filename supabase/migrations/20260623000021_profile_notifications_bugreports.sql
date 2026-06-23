-- Profile picture, notification preferences, and bug reporting.

-- 1. Profile picture + notification preferences on users
alter table public.users
  add column if not exists avatar_url        text,
  add column if not exists notification_prefs jsonb not null default '{
    "new_city": true,
    "birthday": true,
    "long_weekend": true,
    "frequency": "normal"
  }'::jsonb;

-- 2. Bug reports
create table if not exists public.bug_reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  message     text not null,
  attachments text[] not null default '{}',
  status      text not null default 'open',
  created_at  timestamptz not null default now()
);

create index if not exists bug_reports_user_idx on public.bug_reports (user_id);

alter table public.bug_reports enable row level security;

create policy "users insert own bug reports"
  on public.bug_reports for insert
  with check (auth.uid() = user_id);

create policy "users read own bug reports"
  on public.bug_reports for select
  using (auth.uid() = user_id);

-- 3. Storage: avatars (public read, owner-scoped writes under <user_id>/...)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars owner write"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars owner update"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars owner delete"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 4. Storage: bug-reports (private, owner-scoped under <user_id>/...)
insert into storage.buckets (id, name, public)
values ('bug-reports', 'bug-reports', false)
on conflict (id) do nothing;

create policy "bug report attachments owner write"
  on storage.objects for insert
  with check (bucket_id = 'bug-reports' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "bug report attachments owner read"
  on storage.objects for select
  using (bucket_id = 'bug-reports' and (storage.foldername(name))[1] = auth.uid()::text);
