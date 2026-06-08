-- V2: pg_cron jobs

-- Delete expired archived saves (daily 3am IST = 21:30 UTC)
select cron.schedule(
  'delete-expired-archives',
  '30 21 * * *',
  $$delete from public.archived_saves where expires_at < now()$$
);

-- Queue cleanup notifications for dormant libraries (Sunday 10am IST = 04:30 UTC)
select cron.schedule(
  'queue-cleanup-notifications',
  '30 4 * * 0',
  $$
  insert into public.notification_log (user_id, save_ids, trigger_type, copy)
  select
    s.user_id,
    array_agg(s.id) filter (where s.id is not null),
    'cleanup_prompt',
    'You have ' || count(*)::text || ' saves that could use a review.'
  from public.saves s
  where s.acted_on = false
    and s.note is null
    and s.created_at < now() - interval '60 days'
    and (s.last_viewed_at is null or s.last_viewed_at < now() - interval '30 days')
    and s.archived = false
  group by s.user_id
  having count(*) >= 5
  $$
);

-- Generate monthly Wrapped for active users (1st of month, 9am IST = 03:30 UTC)
select cron.schedule(
  'generate-monthly-wrapped',
  '30 3 1 * *',
  $$
  select net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/generate-wrapped-batch',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'))
  )
  $$
);
