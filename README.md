# WatchShare (Supabase Realtime)

映画やドラマの「見たいリスト」を、同じURLを開いたメンバーで同時編集できるWebサイトです。

## できること

- 作品の追加（タイトル / 種別 / メモ）
- 検索
- 視聴済み切り替え
- 個別削除 / ルーム全削除
- `room` URLパラメータでルーム分離
- Supabase Realtimeで同時反映

## 1. Supabaseプロジェクトを作成

1. Supabaseで新規プロジェクトを作る
2. SQL Editorで以下を実行する

```sql
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
```

## 2. キーを設定

`supabase-config.js` を編集して、Project URL と anon key を入れる。

```js
window.WATCHSHARE_SUPABASE_URL = "https://xxxx.supabase.co";
window.WATCHSHARE_SUPABASE_ANON_KEY = "your-anon-key";
```

## 3. 公開する

`file://` ではDiscord共有できないため、Vercel/Netlify/GitHub Pagesのどれかで公開する。

## 4. Discordで共有する

公開URLに `?room=discord` を付けて投稿する。

例:

`https://your-site.example/?room=discord`

同じ `room` を開いた全員で同時編集できる。

## 注意

- 現在は認証なしなので、URLを知っている人は誰でも編集可能。
- 本格運用するなら、次段階でログイン制御を追加するのがおすすめ。
