-- Storage bucket for save thumbnails.
-- Re-hosting is required because platform CDN links expire (spec §3.4).
-- Bucket is public — thumbnails are not user-sensitive.

insert into storage.buckets (id, name, public)
values ('saves', 'saves', true)
on conflict (id) do nothing;

-- Service role (used by the enrich-save Edge Function) bypasses RLS for writes.
-- Grant public read so thumbnail_url values work without auth headers.
create policy "saves thumbnails public read"
  on storage.objects for select
  using (bucket_id = 'saves');
