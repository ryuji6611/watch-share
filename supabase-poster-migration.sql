alter table public.watch_items
add column if not exists poster_url text not null default '';
