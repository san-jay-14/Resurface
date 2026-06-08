-- V2: Wrapped personality card history
create table if not exists public.wrapped_history (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  period_start   date not null,
  period_end     date not null default current_date,
  stats_snapshot jsonb not null,
  copy           jsonb not null, -- { headline, label, roast, closing }
  created_at     timestamptz not null default now()
);

create index if not exists wrapped_history_user_idx
  on public.wrapped_history (user_id, created_at desc);
