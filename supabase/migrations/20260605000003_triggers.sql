-- Auto-provision a public.users profile whenever an auth.users row is created.
-- Covers Google, Apple, and anonymous (guest) sign-ins. Runs as definer so it
-- can insert past RLS; search_path is pinned for safety.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, name, email, is_guest)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name'
    ),
    new.email,
    coalesce(new.is_anonymous, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep device_tokens.updated_at fresh on upsert/update.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger device_tokens_touch_updated_at
  before update on public.device_tokens
  for each row execute function public.touch_updated_at();
