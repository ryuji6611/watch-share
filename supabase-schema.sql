create table if not exists public.watch_items (
  id uuid primary key default gen_random_uuid(),
  room_id text not null,
  title text not null,
  type text not null check (type in ('映画', 'ドラマ')),
  note text not null default '',
  watched boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.watch_items enable row level security;

create policy "watch_items read all"
on public.watch_items
for select
using (true);

create policy "watch_items insert all"
on public.watch_items
for insert
with check (true);

create policy "watch_items update all"
on public.watch_items
for update
using (true)
with check (true);

create policy "watch_items delete all"
on public.watch_items
for delete
using (true);

alter publication supabase_realtime add table public.watch_items;
