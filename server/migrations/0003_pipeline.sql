-- Enrichment pipeline: global post cache, analysis cache, Postgres job queue, provider
-- controls and the step-level trace that feeds the admin dashboard.
-- Ported from the Supabase-era migration: tables, functions and views are unchanged; roles,
-- RLS, grants, realtime and pg_cron/pg_net are gone (only the API server connects; scheduling
-- is done by the application's /internal/tick, see scheduled_tasks).

-- ----------------------------------------------------------------------------
-- Pipeline tables
-- ----------------------------------------------------------------------------
create table if not exists post_cache (
  platform text not null,
  content_id text not null,
  status text not null check (status in ('fetching','ok','not_found','private','error')),
  lock_until timestamptz,
  meta jsonb,                         -- normalized PostMeta (comments live in meta.extras)
  raw jsonb,                          -- provider payload for schema-drift debugging
  content_hash text,                  -- hash of title + text, used by the refresh job
  schema_version int not null default 1,
  provider text,
  fetched_at timestamptz,
  expires_at timestamptz,             -- soft TTL: refetch after this
  purge_after timestamptz not null,   -- hard retention: row is deleted after this
  frames_retry_after timestamptz,     -- negative cache for blocked video acquisition
  primary key (platform, content_id)
);
create index if not exists post_cache_purge_idx on post_cache (purge_after);

create table if not exists post_analysis (
  platform text not null,
  content_id text not null,
  prompt_version int not null,
  model text not null,
  category text,
  confidence real,
  spots jsonb,                        -- [{name, city, activity, price_hint, best_time, place_id, coords_fetched_at}]
  resolved_by text check (resolved_by in ('caption','comments','thumbnails','frames')),
  created_at timestamptz not null default now(),
  primary key (platform, content_id, prompt_version, model)
);

create table if not exists enrichment_jobs (
  id bigint generated always as identity primary key,
  save_id uuid not null references saves (id) on delete cascade,
  platform text not null,
  content_id text not null,
  stage text not null default 'fetch' check (stage in ('fetch','comments','frames','classify','refresh')),
  status text not null default 'queued' check (status in ('queued','running','done','dead')),
  attempts int not null default 0,
  next_run_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (save_id, stage)
);
create index if not exists enrichment_jobs_status_idx on enrichment_jobs (status, next_run_at);

create table if not exists provider_health (
  provider text primary key,
  consecutive_failures int not null default 0,
  open_until timestamptz,
  spend_today numeric not null default 0,
  spend_day date not null default (now() at time zone 'utc')::date,
  last_error text,
  last_success_at timestamptz,
  last_failure_at timestamptz
);

create table if not exists provider_calls (
  id bigint generated always as identity primary key,
  provider text not null,
  endpoint text not null,
  platform text,
  content_id text,
  status_code int,
  latency_ms int,
  est_cost numeric,
  created_at timestamptz not null default now()
);
create index if not exists provider_calls_created_idx on provider_calls (created_at);
create index if not exists provider_calls_provider_idx on provider_calls (provider, created_at);

create table if not exists feature_flags (
  key text primary key,
  enabled boolean not null default false
);
insert into feature_flags values ('frames_instagram_enabled', false), ('frames_youtube_enabled', false)
  on conflict (key) do nothing;

-- Step-level trace feeding the dashboard: one row per pipeline step per run.
create table if not exists pipeline_events (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  job_id bigint,
  save_id uuid,
  platform text,
  content_id text,
  step text not null,
  status text not null check (status in ('ok','error','skip','info','warn')),
  message text,
  duration_ms int,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists pipeline_events_run_idx on pipeline_events (run_id, id);
create index if not exists pipeline_events_created_idx on pipeline_events (created_at desc);
create index if not exists pipeline_events_status_idx on pipeline_events (status, created_at desc);

-- Fired alerts (also the dedupe ledger so a flapping provider does not spam).
create table if not exists pipeline_alerts (
  id bigint generated always as identity primary key,
  key text not null,
  kind text not null,
  message text,
  delivered boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists pipeline_alerts_key_idx on pipeline_alerts (key, created_at desc);

-- ----------------------------------------------------------------------------
-- Functions
-- ----------------------------------------------------------------------------

-- Single-statement job claim. p_stages lets the frames worker and the drain
-- function each take only their own stages.
create or replace function claim_jobs(batch_size int, p_stages text[] default null)
returns setof enrichment_jobs language sql as $$
  update enrichment_jobs
     set status = 'running', locked_at = now(), attempts = attempts + 1
   where id in (
     select id from enrichment_jobs
      where status = 'queued' and next_run_at <= now()
        and (p_stages is null or stage = any (p_stages))
      order by next_run_at
      limit batch_size
      for update skip locked)
  returning *;
$$;

-- Single-flight lock on a post. Returns 'acquired' or 'held'.
create or replace function post_cache_lock(
  p_platform text, p_content_id text, p_lock_seconds int, p_purge_after timestamptz,
  p_force boolean default false)
returns text language plpgsql as $$
declare v_n int;
begin
  insert into post_cache (platform, content_id, status, lock_until, purge_after)
  values (p_platform, p_content_id, 'fetching', now() + make_interval(secs => p_lock_seconds), p_purge_after)
  on conflict do nothing;
  if found then return 'acquired'; end if;

  -- Take over a stale lock, or a row whose soft TTL has lapsed.
  update post_cache
     set status = 'fetching', lock_until = now() + make_interval(secs => p_lock_seconds)
   where platform = p_platform and content_id = p_content_id
     and ((status = 'fetching' and (lock_until is null or lock_until < now()))
       or (status <> 'fetching' and (p_force or expires_at is null or expires_at < now())));
  get diagnostics v_n = row_count;
  return case when v_n > 0 then 'acquired' else 'held' end;
end $$;

-- Circuit breaker + spend bookkeeping, atomic. Opens after p_threshold
-- consecutive failures for p_base_minutes, doubling per extra failure up to 60.
create or replace function provider_record(
  p_provider text, p_ok boolean, p_cost numeric, p_error text,
  p_threshold int default 5, p_base_minutes int default 5)
returns jsonb language plpgsql as $$
declare r provider_health; v_opened boolean := false; v_minutes int;
begin
  insert into provider_health (provider) values (p_provider) on conflict do nothing;
  update provider_health set spend_today = 0, spend_day = (now() at time zone 'utc')::date
   where provider = p_provider and spend_day <> (now() at time zone 'utc')::date;

  if p_ok then
    update provider_health
       set consecutive_failures = 0, open_until = null,
           spend_today = spend_today + coalesce(p_cost, 0), last_success_at = now()
     where provider = p_provider returning * into r;
  else
    update provider_health
       set consecutive_failures = consecutive_failures + 1,
           spend_today = spend_today + coalesce(p_cost, 0),
           last_error = left(p_error, 500), last_failure_at = now()
     where provider = p_provider returning * into r;
    if r.consecutive_failures >= p_threshold then
      v_minutes := least(p_base_minutes * (2 ^ (r.consecutive_failures - p_threshold))::int, 60);
      v_opened := r.open_until is null or r.open_until < now();
      update provider_health set open_until = now() + make_interval(mins => v_minutes)
       where provider = p_provider returning * into r;
    end if;
  end if;
  return jsonb_build_object('opened', v_opened, 'open_until', r.open_until,
                            'consecutive_failures', r.consecutive_failures);
end $$;

-- Force the breaker open until a given time (e.g. YouTube quota reset).
create or replace function provider_open_until(p_provider text, p_until timestamptz, p_error text)
returns void language sql as $$
  insert into provider_health (provider, open_until, last_error, last_failure_at)
  values (p_provider, p_until, left(p_error, 500), now())
  on conflict (provider) do update
    set open_until = greatest(provider_health.open_until, excluded.open_until),
        last_error = excluded.last_error, last_failure_at = now();
$$;

-- Alert dedupe: returns true when the caller should actually deliver the alert.
create or replace function alert_try(p_key text, p_kind text, p_message text, p_cooldown_minutes int default 30)
returns boolean language plpgsql as $$
begin
  if exists (select 1 from pipeline_alerts
              where key = p_key and created_at > now() - make_interval(mins => p_cooldown_minutes)) then
    return false;
  end if;
  insert into pipeline_alerts (key, kind, message) values (p_key, p_kind, left(p_message, 1000));
  return true;
end $$;

-- How many fetch jobs a user has had run today (UTC), counted up to and including
-- p_upto_job: i.e. "this is the user's Nth enrichment today". Used for the daily cap.
create or replace function user_enrichment_count_today(p_user uuid, p_upto_job bigint default null)
returns int language sql stable as $$
  select count(*)::int
    from enrichment_jobs j join saves s on s.id = j.save_id
   where s.user_id = p_user and j.stage = 'fetch'
     and j.status in ('running','done')
     and j.created_at >= (now() at time zone 'utc')::date
     and (p_upto_job is null or j.id <= p_upto_job);
$$;

-- Requeue jobs stuck in 'running' (drain crashed / timed out).
create or replace function reap_stuck_jobs()
returns int language plpgsql as $$
declare n int;
begin
  update enrichment_jobs set status = 'queued', next_run_at = now()
   where status = 'running' and locked_at < now() - interval '5 minutes';
  get diagnostics n = row_count;
  return n;
end $$;

-- Enqueue a refresh for every YouTube post nearing hard retention that an
-- active (non-archived) save still references.
create or replace function enqueue_youtube_refresh()
returns int language plpgsql as $$
declare n int;
begin
  insert into enrichment_jobs (save_id, platform, content_id, stage)
  select distinct on (c.content_id) s.id, 'youtube', c.content_id, 'refresh'
    from post_cache c
    join saves s on s.platform = 'youtube' and s.content_id = c.content_id and s.archived = false
   where c.platform = 'youtube' and c.purge_after < now() + interval '5 days'
   order by c.content_id, s.created_at
  on conflict (save_id, stage) do update
    set status = 'queued', next_run_at = now(), attempts = 0, last_error = null, finished_at = null
    where enrichment_jobs.status in ('done','dead');
  get diagnostics n = row_count;
  return n;
end $$;

-- ----------------------------------------------------------------------------
-- Views (metrics + dead-letter + dashboard run list). Service role only.
-- ----------------------------------------------------------------------------
create or replace view v_dead_letter as
  select j.id, j.save_id, j.platform, j.content_id, j.stage, j.attempts, j.last_error,
         j.created_at, j.finished_at
    from enrichment_jobs j where j.status = 'dead';

create or replace view v_breaker_state as
  select provider, consecutive_failures, open_until,
         (open_until is not null and open_until > now()) as is_open,
         spend_today, spend_day, last_error, last_success_at, last_failure_at
    from provider_health;

create or replace view v_cache_hit_rates as
  select step,
         count(*) filter (where (meta->>'hit')::boolean) as hits,
         count(*) filter (where not (meta->>'hit')::boolean) as misses,
         round(100.0 * count(*) filter (where (meta->>'hit')::boolean) / nullif(count(*), 0), 1) as hit_pct
    from pipeline_events
   where step in ('analysis_cache','post_cache') and meta ? 'hit'
     and created_at > now() - interval '7 days'
   group by step;

create or replace view v_rung_resolution as
  select resolved_by, count(*) as saves
    from post_analysis group by resolved_by;

create or replace view v_time_to_categorized as
  select count(*) as n,
         percentile_cont(0.5)  within group (order by extract(epoch from (enriched_at - created_at))) as p50_sec,
         percentile_cont(0.95) within group (order by extract(epoch from (enriched_at - created_at))) as p95_sec
    from saves
   where enriched_at is not null and enrichment_status = 'done'
     and created_at > now() - interval '7 days';

create or replace view v_cost_per_resolved_save as
  select (select coalesce(sum(est_cost), 0) from provider_calls
           where created_at > now() - interval '7 days') as spend_7d,
         (select count(*) from saves
           where enrichment_status = 'done' and created_at > now() - interval '7 days') as resolved_7d;

create or replace view v_pipeline_runs as
  select run_id,
         min(created_at) as started_at, max(created_at) as last_event_at,
         (array_agg(job_id)    filter (where job_id is not null))[1]  as job_id,
         (array_agg(save_id)   filter (where save_id is not null))[1] as save_id,
         max(platform) as platform, max(content_id) as content_id,
         count(*) as steps,
         count(*) filter (where status = 'error') as errors,
         count(*) filter (where status = 'warn')  as warnings,
         sum(duration_ms) as total_ms,
         (array_agg(step || ': ' || coalesce(message, '') order by id desc))[1] as last_step
    from pipeline_events
   group by run_id;
