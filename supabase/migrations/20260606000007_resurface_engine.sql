-- Resurface Engine — Milestone 4
-- Adds missing long-weekend calendar entries and schedules the daily trigger check.
--
-- SETUP REQUIRED before this job will fire:
--   1. In the Supabase Dashboard → Vault → Secrets, add:
--        name="supabase_project_url"  value="https://wsnrkbldvrzyqnqexcvo.supabase.co"
--        name="service_role_key"      value="<your service-role key>"
--   2. In Dashboard → Database → Extensions, confirm pg_cron and pg_net are enabled.
--   3. Deploy the resurface-check Edge Function:
--        supabase functions deploy resurface-check
-- ---------------------------------------------------------------------------

-- Additional long weekends missing from the starter seed (2026–2027)
insert into public.calendar_events (name, type, date, region) values
  -- Republic Day 2026: Jan 26 falls on a Monday → Sat–Sun–Mon 3-day weekend
  ('Republic Day weekend', 'long_weekend', date '2026-01-26', 'IN'),
  -- Holi 2027: March 22 falls on a Monday → Sat–Sun–Mon 3-day weekend
  ('Holi weekend',         'long_weekend', date '2027-03-22', 'IN'),
  -- Diwali 2026: Nov 8 (Sunday) — Diwali itself is the weekend; Bhai Dooj Nov 11
  -- Tag the multi-day Diwali break explicitly for the engine
  ('Diwali break',         'long_weekend', date '2026-11-08', 'IN')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Postgres function: reads Vault secrets and POSTs to the resurface-check
-- Edge Function via pg_net. Called by pg_cron daily at 10:00 AM IST (04:30 UTC).
-- ---------------------------------------------------------------------------
create or replace function public.trigger_resurface_check()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  -- Read secrets from Supabase Vault (Dashboard → Vault → Secrets)
  select decrypted_secret into v_url
    from vault.decrypted_secrets
   where name = 'supabase_project_url'
   limit 1;

  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'service_role_key'
   limit 1;

  if v_url is null or v_key is null then
    raise notice '[resurface] Missing vault secrets — skipping trigger check.';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/resurface-check',
    headers := json_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key
               )::jsonb,
    body    := '{}'::jsonb
  );
end;
$$;

-- Schedule: 04:30 UTC = 10:00 IST, safely within the 9am–9pm quiet-hour window.
select cron.schedule(
  'resurface-daily-check',
  '30 4 * * *',
  'select public.trigger_resurface_check()'
);
