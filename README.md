# words_of_wisdom backend (Supabase)

## What this implements
- `quotes`: 名言マスタ（ライブ参照）
- `daily_quote_schedule`: 日付ごとの配信予定（`date -> quote_id`）
- 月次バッチ: JSTで毎月1日に1か月分の予定を自動生成
- 取得関数:
  - `public.get_today_quote()`
  - `public.get_quote_for_date(p_date date)`

## File layout
- `supabase/migrations/0001_quotes_schema.sql`
- `supabase/migrations/0002_quote_batch_and_rpc.sql`
- `supabase/migrations/0003_quote_batch_cron.sql`
- `supabase/seed.sql`

## How scheduling works
- 配信対象は `quotes.is_active = true`
- 並び順は `display_order asc, id asc`
- 前月末の最後の `quote_id` の次から、翌月1日の割当を開始
- `daily_quote_schedule.date` は主キーなのでバッチは冪等（重複しない）

## Setup
1. Supabase SQL Editor で migration を順番に実行
2. `supabase/seed.sql` を実行して初期データ投入
3. 取得確認:
```sql
select * from public.get_today_quote();
```

## API usage example (Supabase JS)
```ts
const { data, error } = await supabase.rpc("get_today_quote");
```

`data[0]` には以下が返ります:
- `date`
- `quote_id`
- `ja_translation`
- `en_translation`
- `original_text`
- `speaker_name`
- `birth_year`
- `death_year`
- `source`

## Frontend (responsive quote page)
- `index.html`
- `styles.css`
- `script.js`
- `today.json`

### Design spec reflected
- 上から `タイトル -> 今日の日付 -> 日本語訳 -> 英語訳 -> 原文 -> 発言者`
- 英語/原文: `Instrument Serif` Regular
- 日本語: `Zen Old Mincho` Bold
- レスポンシブ対応（スマホ/PC）
- CSSは `:root` のカスタムプロパティで一括調整可能

### Local preview
`index.html` をブラウザで開くと表示されます。

### Data source
`index.html` は `today.json` を参照します:
```html
<main class="quote-page" data-api-endpoint="./today.json">
```

`today.json` は以下キーを持つ想定:
- `date`
- `ja_translation`
- `en_translation`
- `original_text`
- `speaker_name`
- `birth_year`
- `death_year`
- `source`

## Daily static JSON generation
Supabase RPC (`get_today_quote`) を1回呼び、`today.json` を更新します。

### Commands
```bash
npm run generate:today
```

環境変数:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`（または `SUPABASE_SERVICE_ROLE_KEY`）

例:
```bash
SUPABASE_URL="https://<project-ref>.supabase.co" \
SUPABASE_ANON_KEY="<anon-key>" \
npm run generate:today
```

### Automation (GitHub Actions)
`/.github/workflows/update-today-json.yml` を追加済みです。
毎日 00:10 JST に `today.json` を更新し、差分があれば自動コミットします。

GitHub repository secrets:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

ローカルテスト用（ネットワーク不要）:
```bash
node scripts/generate-today-json.mjs --input-file today.json --output /tmp/today.out.json
```

## Tests
```bash
npm test
```
