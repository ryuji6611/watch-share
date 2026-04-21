update public.watch_items
set type = case
  when type = '映画' then '邦画'
  when type = 'ドラマ' then '国内ドラマ'
  else type
end;

alter table public.watch_items
drop constraint if exists watch_items_type_check;

alter table public.watch_items
add constraint watch_items_type_check
check (type in ('洋画', '邦画', '国内ドラマ', '海外ドラマ'));
