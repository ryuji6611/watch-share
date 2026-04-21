alter table public.watch_items
add column if not exists overview_ja text not null default '';
