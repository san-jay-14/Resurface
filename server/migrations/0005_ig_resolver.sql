-- Instagram resolver: device-submitted metadata, per-provider canary history, weekly stage metrics.
--
-- Device metadata is UNTRUSTED (a client can forge it). It never enters post_cache or post_analysis,
-- which are served to every user, until two distinct users submit the same content hash for the same
-- post (corroboration). Until then it only ever serves the submitting user's own save.

create table if not exists device_submissions (
  platform     text not null default 'instagram',
  content_id   text not null,
  content_hash text not null,
  user_id      uuid not null references users (id) on delete cascade,
  meta         jsonb not null,             -- validated + sanitized PostMeta (never the raw client payload)
  created_at   timestamptz not null default now(),
  primary key (platform, content_id, content_hash, user_id)
);
create index if not exists device_submissions_user_idx
  on device_submissions (user_id, platform, content_id, created_at desc);
create index if not exists device_submissions_created_idx on device_submissions (created_at);

-- One row per (provider, canary post) probe. The canary alerts on the failure rate of the last few.
create table if not exists provider_canary (
  id          bigint generated always as identity primary key,
  provider    text not null,
  content_id  text not null,
  ok          boolean not null,
  latency_ms  int,
  error_code  text,
  checked_at  timestamptz not null default now()
);
create index if not exists provider_canary_idx on provider_canary (provider, checked_at desc);

-- One row per finished Instagram job run, bucketed by where the metadata came from.
-- Weekly stage distribution:  select date_trunc('week', at) w, stage, count(*) from ig_resolve_runs group by 1, 2;
create or replace view ig_resolve_runs as
select run_id,
       min(created_at) as at,
       case
         when bool_or(step in ('analysis_cache', 'post_cache') and coalesce((meta->>'hit')::boolean, false)) then 'cache'
         when bool_or(step = 'device_meta' and status = 'ok') then 'device'
         when bool_or(step = 'fetch' and status = 'ok') then 'provider'
         else 'visual'
       end as stage
  from pipeline_events
 where platform = 'instagram' and job_id is not null
 group by run_id
having bool_or(step = 'job' and (status = 'ok' or message like 'needs_review%'));
