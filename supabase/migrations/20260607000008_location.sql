-- Milestone 5: Location — adds current-city tracking to users.
--
-- The app updates current_city when it detects a city change on app foreground.
-- The daily cron checks current_city != home_city to fire the new-city trigger.

alter table public.users
  add column if not exists current_city            text,
  add column if not exists current_city_lat        double precision,
  add column if not exists current_city_lng        double precision,
  add column if not exists current_city_updated_at timestamptz;

-- Index for the new-city trigger query (find users who are away from home)
create index if not exists users_current_city_idx
  on public.users (current_city)
  where current_city is not null;
