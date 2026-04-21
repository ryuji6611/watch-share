# WatchShare (Supabase Realtime)

映画やドラマの「見たいリスト」を、同じURLを開いたメンバーで同時編集できるWebサイトです。

## できること

- 作品の追加（タイトル / 種別 / メモ）
- 追加時にポスター画像を自動取得（TMDB）
- 追加時に日本語あらすじを自動取得（TMDB）
- 見たい / 視聴済みの2リスト表示
- 検索
- 視聴済み切り替え
- 個別削除 / ルーム全削除
- `room` URLパラメータでルーム分離
- Supabase Realtimeで同時反映

## 1. Supabaseプロジェクトを作成

1. Supabaseで新規プロジェクトを作る
2. SQL Editorで [supabase-schema.sql](./supabase-schema.sql) を実行する
3. 既存環境は追加で [supabase-poster-migration.sql](./supabase-poster-migration.sql) を実行する
4. 既存環境は追加で [supabase-overview-migration.sql](./supabase-overview-migration.sql) を実行する
5. 種別を新分類にする場合は [supabase-type-migration.sql](./supabase-type-migration.sql) を実行する

## 2. キーを設定

`supabase-config.js` を編集して、Project URL / Publishable key / TMDB key を入れる。

```js
window.WATCHSHARE_SUPABASE_URL = "https://xxxx.supabase.co";
window.WATCHSHARE_SUPABASE_ANON_KEY = "sb_publishable_xxx";
window.WATCHSHARE_TMDB_API_KEY = "tmdb_api_key";
```

TMDB API key は [TMDB](https://www.themoviedb.org/settings/api) で発行。

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
