# Manus向け調査依頼: stockout-analysis エンドポイントのデプロイ未反映問題

## 概要

前回の調査でRailwayのリポジトリ接続問題は解決されましたが、`stockout-analysis`エンドポイントにはまだコード修正が反映されていません。

## 現在の状況

### エンドポイント別の動作確認結果

| エンドポイント | 結果 | 状態 |
|--------------|------|------|
| `/api/stock?storeId=4` | **9,562件** | ✅ 修正反映済み |
| `/api/forecast/stockout-analysis/4` | **stockCacheTotal: 1000** | ❌ 未反映 |
| `/api/forecast/stockout-analysis/1` | **stockCacheTotal: 1000** | ❌ 未反映 |

### 問題のあるAPIレスポンス

```bash
curl -s "https://fc-demand-forecast-production.up.railway.app/api/forecast/stockout-analysis/4?month=2025-12" | jq '.data.summary'
```

**現在の結果（問題あり）**:
```json
{
  "activeProductCount": 985,
  "recentSalesCount": 699,
  "stockWithPositive": 501,
  "stockCacheTotal": 1000,      // ← 1000件で止まっている
  "queryParams": {
    "storeId": "4",
    "storeIdType": "string",
    "activeStartDate": "2025-10-02",
    "endDate": "2025-12-31",
    "recentSalesDataLength": 1000  // ← 1000件で止まっている
  }
}
```

**期待される結果（修正後）**:
```json
{
  "activeProductCount": 1500以上,
  "stockCacheTotal": 1000以上,
  "queryParams": {
    "recentSalesDataLength": 1000以上
  }
}
```

### 正常に動作しているエンドポイント

```bash
curl -s "https://fc-demand-forecast-production.up.railway.app/api/stock?storeId=4" | jq '{success, count}'
```

**結果**:
```json
{
  "success": true,
  "count": 9562  // ← 正しく10000件以上取得できている
}
```

## GitHub上のコード（正しい状態）

**ファイル**: `backend/src/routes/forecast.ts`
**最新コミット**: `de8965e` (Merge pull request #8)

### 修正されているはずのコード

**Step 1: allStockDataクエリ（行326-331）**
```typescript
// Step 1: 全在庫データを取得
// 注意: .eq()ではなく.in()を使用（型変換の違いで取得件数が異なる問題を回避）
// 注意: Supabaseのデフォルト上限は1000件なので、limitを明示的に指定
const { data: allStockData } = await supabase
  .from('stock_cache')
  .select('product_id, stock_amount')
  .in('store_id', [storeId])
  .limit(10000);  // ← この行が追加されているはず
```

**Step 2: recentSalesDataクエリ（行334-342）**
```typescript
// Step 2: 直近N日に売上がある商品IDを取得（現行品判定用）
// 注意: Supabaseのデフォルト上限は1000件なので、limitを明示的に指定
const activeStartDate = addDaysSimple(startDate, -ACTIVE_PRODUCT_LOOKBACK_DAYS);
const { data: recentSalesData } = await supabase
  .from('sales_daily_summary')
  .select('product_id')
  .in('store_id', [storeId])
  .gte('sale_date', activeStartDate)
  .lte('sale_date', endDate)
  .limit(10000);  // ← この行が追加されているはず
```

## 考えられる原因

### 1. デプロイキャッシュの問題
- Railwayがビルドキャッシュを使用していて、古いコードがデプロイされている可能性

### 2. 部分的なデプロイ
- `/api/stock`は別のサービスファイル（`stock.ts`）
- `/api/forecast/stockout-analysis`は`forecast.ts`
- `forecast.ts`だけが古いままの可能性

### 3. ビルドエラー
- TypeScriptのコンパイルで`forecast.ts`がエラーになっている可能性

## 確認してほしい項目

### 1. Railway Build Logsの確認
- [ ] ビルドが正常に完了しているか
- [ ] TypeScriptコンパイルエラーがないか
- [ ] `forecast.ts`が正しくコンパイルされているか

### 2. 実際にデプロイされたコードの確認
Railway のコンテナ内で以下を確認：
```bash
# デプロイされた dist/routes/forecast.js の内容を確認
cat dist/routes/forecast.js | grep -A5 "stock_cache"
```

### 3. キャッシュクリアと再デプロイ
- [ ] Railway Dashboard で「Clear Build Cache」を実行（存在する場合）
- [ ] 「Redeploy」を実行
- [ ] デプロイ完了後、APIレスポンスを再確認

### 4. 環境変数の確認
- [ ] NODE_ENV が正しく設定されているか
- [ ] TypeScriptのビルド設定が正しいか

## 検証コマンド

修正が反映されたかの確認：
```bash
# stockout-analysis エンドポイント
curl -s "https://fc-demand-forecast-production.up.railway.app/api/forecast/stockout-analysis/4?month=2025-12" | jq '.data.summary | {activeProductCount, stockCacheTotal, recentSalesDataLength: .queryParams.recentSalesDataLength}'

# 比較用: stock エンドポイント（こちらは正常）
curl -s "https://fc-demand-forecast-production.up.railway.app/api/stock?storeId=4" | jq '{success, count}'
```

## PR履歴

| PR | 内容 | 状態 |
|----|------|------|
| #8 | fix: allStockDataクエリにも.limit(10000)を追加 | マージ済み ← **これが反映されていない** |
| #7 | fix: Supabaseの1000件制限を回避するため.limit(10000)を追加 | マージ済み |
| #6 | debug: クエリパラメータ確認用デバッグ情報追加 | マージ済み |

## 期待される最終結果

修正が正しくデプロイされた場合：
- `stockCacheTotal` > 1000（現在は1000で止まっている）
- `recentSalesDataLength` > 1000（現在は1000で止まっている）
- `activeProductCount` ≈ 1,600（現在は985）

---

**調査日時**: 2026年2月5日
**報告者**: Claude Code
**Session ID**: session_013nPrUWYMKoYH3diEguHQ5b
