-- User-created sub-categories per category (e.g. "Goa Restaurants" under Places)
create table if not exists user_sub_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  name text not null,
  emoji text not null default '📁',
  created_at timestamptz not null default now()
);

alter table user_sub_categories enable row level security;

create policy "users manage own sub_categories"
  on user_sub_categories for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Link each save to an optional sub-category
alter table saves
  add column if not exists sub_category_id uuid references user_sub_categories(id) on delete set null;

create index if not exists idx_saves_sub_category_id on saves(sub_category_id);
create index if not exists idx_user_sub_categories_user_category on user_sub_categories(user_id, category);
