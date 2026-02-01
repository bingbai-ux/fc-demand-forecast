# サキヨミ 売上データ同期 総合分析レポート

**作成日**: 2026年2月1日  
**対象**: fc-demand-forecast リポジトリ  
**分析範囲**: 売上データの取得（2024-01〜2025-12）が各店舗でうまくいかない原因

---

## エグゼクティブサマリー

売上データの同期が失敗する**根本原因は複数のバグの複合**です。単一の原因ではなく、タイムアウト、ページネーション不備、リカバリー機能の欠如、タイムゾーン問題などが重なり合っています。以下に重要度順で全問題を整理します。

---

## 🔴 致命的な問題（これが主原因）

### 問題1: `syncSalesForPeriod`のタイムアウト（最大の原因）

**ファイル**: `backend/src/services/sync/salesSync.ts` L206-260

**症状**: フロントエンドの「売上を同期」ボタンを押して2024-01〜2025-12を同期しようとすると、必ず失敗する。

**原因**: `syncSalesForPeriod`は日付ごとに1日ずつループ処理する。2024-01-01〜2025-12-31 = **約730日間**。各日で:

- スマレジAPIへの通信（複数ページあり得る）
- sales_cacheのdelete＋insert
- sales_daily_summaryの更新
- 日付間の500msウェイト

最低でも **730日 × 500ms = 365秒（6分）** + API通信時間 + DB処理時間で、実質 **30分〜数時間** かかる。

しかし:
- **フロントエンドのタイムアウト**: `SYNC_TIMEOUT = 600000`（10分）
- **Railwayのリクエストタイムアウト**: 通常5〜10分
- **Supabaseのコネクションタイムアウト**: デフォルト60秒

→ **途中で必ずタイムアウトする**

```typescript
// salesSync.ts L223-225 - 730日をシーケンシャルに処理
for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
  const dateStr = d.toISOString().split('T')[0];
  const result = await syncSalesForDate(dateStr);  // 1日ずつAPI呼び出し
  ...
  await new Promise(resolve => setTimeout(resolve, 500));  // 500ms待機
}
```

**修正方針**: 長期間同期は `store-by-store` エンドポイントのようにバックグラウンド処理にすべき。フロントエンドにはジョブIDを返し、ポーリングで進捗を確認する形に変更する。

---

### 問題2: `build-summary`のページネーション未実装（Supabase 1000行制限）

**ファイル**: `backend/src/routes/sync.ts` L203-241

**症状**: `POST /api/sync/build-summary` で `sales_cache` → `sales_daily_summary` の再構築を実行しても、データが不完全になる。

**原因**: 月ごとに `sales_cache` を取得するクエリに **ページネーションがない**:

```typescript
// sync.ts L203-208 - ページネーションなし！
const { data: salesData, error: salesError } = await supabase
  .from('sales_cache')
  .select('product_id, store_id, sale_date, quantity, sales_amount, cost_amount')
  .gte('sale_date', monthStart)
  .lte('sale_date', actualEnd + 'T23:59:59');
// ↑ Supabaseのデフォルト上限は1000行。1ヶ月に1001行以上あると切り捨て！
```

FOOD&COMPANYは6店舗あり、各店舗に数百商品×30日 = 1ヶ月で数千〜数万レコードが想定される。**最初の1000件しか処理されない**。

**修正方針**: `fetchSalesFromSummary`（tableDataCache.ts）のように `.range(from, from + PAGE_SIZE - 1)` でページネーションを追加する。

---

### 問題3: 失敗時のリカバリー（中断復帰）機能がない

**ファイル**: `backend/src/services/sync/salesSync.ts` L206-260

**症状**: 同期が300日目で失敗した場合、次回実行時に1日目からやり直しになる。

**原因**: `syncSalesForPeriod`は「どこまで処理したか」を記録していない。

```typescript
// 失敗した場合
} catch (error: any) {
  await supabase
    .from('sync_status')
    .update({ status: 'error', error_message: error.message })  // エラー情報のみ保存
    .eq('sync_type', 'sales');
  // → 「どの日付まで完了したか」は記録されない
}
```

**対比**: `store-by-store` エンドポイントは `sales_daily_summary` に既存データがあればスキップする設計になっているが、`syncSalesForPeriod` にはそのロジックがない。

**修正方針**: `sync_status`テーブルに `last_synced_date` フィールドがあるので、これを日付ごとに更新して中断復帰可能にする。

---

### 問題4: `store-by-store`が売上ゼロの日を毎回再取得する

**ファイル**: `backend/src/routes/sync.ts` L522-546

**症状**: `POST /api/sync/sales/store-by-store` を何度実行しても「取得対象: XXX日分」の数が減らない。

**原因**: 欠損日判定が `sales_daily_summary` にレコードがあるかどうかで行われる:

```typescript
// sync.ts L522-533
const { data: existingDates } = await supabase
  .from('sales_daily_summary')
  .select('sale_date')
  .eq('store_id', storeId)
  .gte('sale_date', targetFrom)
  .lte('sale_date', targetTo + 'T23:59:59');

const existingDateSet = new Set(existingDates?.map(d => d.sale_date?.split('T')[0]) || []);
```

**売上がゼロの日はsales_daily_summaryにレコードが作成されない**ため、「欠損」と判定されて毎回APIを呼び出す。定休日や営業開始前の日は永遠に「欠損」扱いになる。

例: 代官山店が2024年1月に5日しか売上がなかった場合、残りの26日は毎回スマレジAPIを呼び出す。6店舗 × 730日 で、大量の無駄なAPI呼び出しが発生。

**修正方針**: 以下のいずれか:
- 売上ゼロの日も `sales_daily_summary` に `quantity=0` のレコードを挿入する
- 別テーブル（`sync_log` など）で「この日付・この店舗はAPIから取得済み」を記録する

---

## 🟡 中程度の問題

### 問題5: `runDailySync`のタイムゾーンバグ

**ファイル**: `backend/src/index.ts` L81-120

**症状**: 自動同期（Cronモード）が間違った日付のデータを取得する可能性がある。

```typescript
// index.ts L86-88 - UTCベースで計算（間違い）
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const dateStr = yesterday.toISOString().split('T')[0];  // UTC日付
```

サーバーがUTCで動作し、JST 02:00 (= UTC 17:00前日) にCronが実行されると:
- UTC: 2026-01-31 17:00 → yesterday = 2026-01-30 → **JSTでは1/31のデータが欲しいのに1/30を同期**

一方、`/daily`エンドポイント（sync.ts L106-161）は **JST変換を正しく実装**している:

```typescript
// sync.ts L117-123 - JST変換あり（正しい）
const jstOffset = 9 * 60 * 60 * 1000;
const jstNow = new Date(now.getTime() + jstOffset);
const jstYesterday = new Date(jstNow);
jstYesterday.setDate(jstYesterday.getDate() - 1);
const dateStr = jstYesterday.toISOString().split('T')[0];
```

**修正方針**: `runDailySync` にも `/daily` と同じJST変換ロジックを適用する。

---

### 問題6: `/daily`エンドポイントの`updateDailySummaryForDate`二重呼び出し

**ファイル**: `backend/src/routes/sync.ts` L140-145

```typescript
// L141: syncSalesForDate内部でupdateDailySummaryForDateが呼ばれる
const salesResult = await syncSalesForDate(dateStr);

// L145: さらにもう一度明示的に呼ばれる（二重処理）
const summaryCount = await updateDailySummaryForDate(dateStr);
```

`syncSalesForDate` (salesSync.ts L195) が内部で `updateDailySummaryForDate` を呼んでいるため、同じ処理が2回実行される。データ不整合は起きないが、無駄なDB操作。

**修正方針**: `/daily`エンドポイントから明示的な `updateDailySummaryForDate` 呼び出しを削除する。

---

### 問題7: `updateDailySummaryForDate`のページネーション不備

**ファイル**: `backend/src/services/sync/salesSync.ts` L9-71

**症状**: 1日の売上レコードが1000件を超えると集計データが不完全になる。

```typescript
// salesSync.ts L13-17 - ページネーションなし
const { data: salesData, error: salesError } = await supabase
  .from('sales_cache')
  .select('product_id, store_id, sale_date, quantity, sales_amount, cost_amount')
  .gte('sale_date', dateStr)
  .lte('sale_date', dateStr + 'T23:59:59');
// → 1000行上限
```

通常は1日あたり1000件未満と思われるが、6店舗×数百商品の場合は超える可能性あり。

**修正方針**: `range()`を使ったページネーションを追加する。

---

### 問題8: スマレジAPIのレート制限に対するリトライ処理がない

**ファイル**: `backend/src/services/smaregi/client.ts`

**症状**: 大量のAPI呼び出し時にレート制限（429 Too Many Requests）エラーで同期が中断する。

**原因**: axiosクライアントには401（認証エラー）のリトライはあるが、429（レート制限）のリトライがない。

```typescript
// client.ts L40-56 - 401のみリトライ
client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401 && !originalRequest._retry) {
      // リトライ...
    }
    return Promise.reject(error);  // 429はここで即座に失敗
  }
);
```

730日分のデータを取得する場合、最低でも730回のAPI呼び出しが必要。スマレジAPIのレート制限に引っかかる可能性が高い。

**修正方針**: 429レスポンスに対するexponential backoffリトライを追加する。

---

## 🔵 設計・アーキテクチャの問題

### 問題9: 2つの認証システムが混在

**ファイル**: 
- `backend/src/services/smaregi/auth.ts` → **Refresh Token Grant** 方式
- `backend/src/services/smaregi/tokenManager.ts` → **Client Credentials Grant** 方式

両方が `api_tokens` テーブルに書き込む。どちらが使われるかは呼び出し元による。

- `smaregiClient`（client.ts）→ `auth.ts` の `ensureValidToken` を使用
- `tokenManager.ts` → 独立して存在するが、`smaregiClient` からは使われていない

`tokenManager.ts` の `getAccessTokenWithScopes` は `pos.orders:write` スコープを含むClient Credentials方式のトークン取得が可能だが、メインのsyncフローでは使われていない。

**リスク**: 
- 両方が同じテーブルを更新すると、片方が取得したトークンを他方が上書きしてしまう可能性
- `auth.ts` が保存したRefresh Tokenを `tokenManager.ts` が Client Credentials で上書きすると、Refresh Tokenが失われる

**修正方針**: 認証システムを統一する。Client Credentials方式に一本化するのが最もシンプル。

---

### 問題10: `GET /api/sales` ルートがキャッシュDBを迂回する

**ファイル**: `backend/src/routes/sales.ts`

`GET /api/sales` は `getSales()` を呼び出し、**毎回スマレジAPIに直接アクセス**する（5分間のメモリキャッシュはあるが）。一方、メインの表示パスは `sales_daily_summary` テーブルからデータを取得する。

これは2つの独立したデータパスが存在することを意味し、ユーザーが期待するデータフローと実際の挙動が乖離する原因になる。

**修正方針**: `/api/sales` が使われていないなら削除する。使われているならDBキャッシュから取得するように変更する。

---

### 問題11: `sales_cache` と `sales_daily_summary` が実質同じ粒度

**現状のデータフロー**:
```
Smaregi API (トランザクション単位)
  ↓ syncSalesForDate で集約
sales_cache (product_id × store_id × 日付 の粒度)
  ↓ updateDailySummaryForDate で再集約
sales_daily_summary (product_id × store_id × 日付 の粒度) ← 同じ粒度！
```

`sales_cache` と `sales_daily_summary` は同じ粒度（商品×店舗×日付）で、カラム名が異なるだけ:

| sales_cache | sales_daily_summary |
|---|---|
| quantity | total_quantity |
| sales_amount | total_sales |
| cost_amount | total_cost |

2テーブル間の同期が必要な設計になっている（これが前回の「3件 vs 1件」の問題の原因）。

**修正方針**: 中長期的にはテーブルを統一する。短期的には現状維持でOKだが、syncの度に必ず両テーブルを更新する点を厳守する必要がある。

---

### 問題12: カラム名の不一致がバグの温床

`sales_cache`:
```
quantity, sales_amount, cost_amount
```

`sales_daily_summary`:
```
total_quantity, total_sales, total_cost
```

`updateDailySummaryForDate` の中で手動マッピングが必要になっている。名前の不一致は将来のバグの原因になる。

---

## データフロー全体図

```
┌──────────────────────┐
│    スマレジ API        │
│   /pos/transactions   │
└─────────┬────────────┘
          │
          │ syncSalesForDate()
          │ syncSalesForDateAndStore()
          ↓
┌──────────────────────┐     ┌──────────────────────────┐
│    sales_cache        │────→│  sales_daily_summary      │
│  (中間キャッシュ)      │     │  (表示・予測に使用)         │
│  quantity             │     │  total_quantity            │
│  sales_amount         │     │  total_sales               │
│  cost_amount          │     │  total_cost                │
└──────────────────────┘     └────────────┬───────────────┘
                                          │
                              ┌───────────┴───────────┐
                              │                       │
                              ↓                       ↓
                     tableDataCache.ts          forecast.ts
                     (売上分析画面)              (需要予測)
```

**問題箇所**:
- ❌ sales_cache → sales_daily_summary の変換でデータ欠落（問題2, 7）
- ❌ スマレジAPI → sales_cache でタイムアウト（問題1）
- ❌ リカバリーなし（問題3）
- ❌ 売上ゼロ日の再取得（問題4）

---

## 推奨修正の優先順位

### Phase 1: 即座に修正（データ取得を可能にする）

| # | 修正内容 | 対象ファイル | 工数目安 |
|---|---------|-------------|---------|
| 1 | `build-summary` にページネーション追加 | sync.ts L203-241 | 30分 |
| 2 | `updateDailySummaryForDate` にページネーション追加 | salesSync.ts L13-17 | 15分 |
| 3 | `store-by-store` で売上ゼロ日もマーク | sync.ts L522-562 | 1時間 |
| 4 | `/daily` の二重呼び出し修正 | sync.ts L145 | 5分 |

### Phase 2: 安定性向上

| # | 修正内容 | 対象ファイル | 工数目安 |
|---|---------|-------------|---------|
| 5 | `syncSalesForPeriod` に中断復帰機能追加 | salesSync.ts | 2時間 |
| 6 | スマレジAPIに429リトライ追加 | client.ts | 1時間 |
| 7 | `runDailySync` のタイムゾーン修正 | index.ts L86-88 | 10分 |

### Phase 3: アーキテクチャ改善

| # | 修正内容 | 対象ファイル | 工数目安 |
|---|---------|-------------|---------|
| 8 | 認証システムの統一 | auth.ts, tokenManager.ts | 2時間 |
| 9 | `/api/sales` ルートの整理 | sales.ts | 1時間 |
| 10 | テーブル統一 or カラム名統一 | DB設計 | 半日 |

---

## 現状で2024-01〜2025-12のデータを取得する最善の手順

現状のコードのまま最も成功率が高い方法:

### ステップ1: `store-by-store` を月単位で分割実行

```bash
# 1ヶ月ずつ実行（タイムアウト回避）
curl -X POST https://your-backend.railway.app/api/sync/sales/store-by-store \
  -H "Content-Type: application/json" \
  -d '{"from": "2024-01-01", "to": "2024-01-31", "forceUpdate": true}'

# 1ヶ月分が完了したら次の月へ
curl -X POST ... -d '{"from": "2024-02-01", "to": "2024-02-28", "forceUpdate": true}'
# ... 24ヶ月分繰り返し
```

### ステップ2: build-summary で集計テーブルを再構築

```bash
curl -X POST https://your-backend.railway.app/api/sync/build-summary \
  -H "Content-Type: application/json" \
  -d '{"from": "2024-01-01", "to": "2025-12-31"}'
```

⚠️ ただし `build-summary` は問題2（ページネーション不備）があるため、1ヶ月に1000件以上のレコードがある場合はデータが欠落する。

### ステップ3: SQLで直接再構築（最も確実）

問題2を回避するため、SupabaseのSQL Editorで直接実行:

```sql
INSERT INTO sales_daily_summary (product_id, store_id, sale_date, total_quantity, total_sales, total_cost, updated_at)
SELECT 
  product_id, 
  store_id, 
  sale_date::date, 
  SUM(quantity), 
  SUM(sales_amount), 
  SUM(cost_amount), 
  NOW()
FROM sales_cache
WHERE sale_date >= '2024-01-01'
GROUP BY product_id, store_id, sale_date::date
ON CONFLICT (product_id, store_id, sale_date) DO UPDATE SET
  total_quantity = EXCLUDED.total_quantity,
  total_sales = EXCLUDED.total_sales,
  total_cost = EXCLUDED.total_cost,
  updated_at = NOW();
```

---

## 各ファイルの修正箇所一覧

### `backend/src/services/sync/salesSync.ts`
- L13-17: `updateDailySummaryForDate` にページネーション追加
- L206-260: `syncSalesForPeriod` に中断復帰 + 既存データスキップ

### `backend/src/routes/sync.ts`
- L145: 二重呼び出し削除
- L203-241: `build-summary` にページネーション追加
- L536-546: 売上ゼロ日のハンドリング追加

### `backend/src/services/smaregi/client.ts`
- 429レスポンスに対するリトライ追加

### `backend/src/index.ts`
- L86-88: JST変換追加

---

*以上、分析完了*
