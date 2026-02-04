# Manus向け調査依頼: Railway デプロイ問題

## 概要

Railway がGitHubの最新コードをデプロイしていない問題が発生しています。

## 現在の状況

### GitHub側（正常）
- **最新コミット**: `de8965e` (Merge pull request #8)
- **修正コミット**: `1b9a37c` (fix: allStockDataクエリにも.limit(10000)を追加)
- コードは正しく修正されている

### Railway側（問題あり）
- **デプロイされているコミット**: `f19800a4`
- このコミットはGitHubの履歴に存在しない
- 古いコードが動作し続けている

## 問題の症状

APIレスポンスが修正前の値を返し続けている：
```json
{
  "stockCacheTotal": 1000,      // 期待値: > 1000
  "recentSalesDataLength": 1000 // 期待値: > 1000
}
```

## 確認してほしい項目

### 1. Railway Dashboard設定確認
- **Project**: fc-demand-forecast
- **URL**: https://railway.app/project/b0778d67-8ebd-43ed-b709-c0d9dc8dfbcc

確認項目：
- [ ] Source Branch が `main` になっているか
- [ ] GitHub リポジトリの接続が正しいか（bingbai-ux/fc-demand-forecast）
- [ ] Auto Deploy が有効になっているか

### 2. デプロイのトリガー
- [ ] Railway Dashboard で「Redeploy」を実行
- [ ] 新しいデプロイのコミットハッシュが `de8965e` または `1b9a37c` になることを確認

### 3. もしRedeploy後も古いコミットがデプロイされる場合
- [ ] Railway の GitHub 接続を一度削除して再接続
- [ ] Railway の Service を削除して再作成（最終手段）

## 検証コマンド

修正が反映されたかの確認：
```bash
curl -s "https://fc-demand-forecast-production.up.railway.app/api/forecast/stockout-analysis/4?month=2025-12" | jq '.data.summary | {activeProductCount, stockCacheTotal, queryParams}'
```

### 期待される結果（修正後）
```json
{
  "activeProductCount": 1500以上,
  "stockCacheTotal": 1000以上,
  "queryParams": {
    "recentSalesDataLength": 1000以上
  }
}
```

### 現在の結果（修正前＝問題）
```json
{
  "activeProductCount": 985,
  "stockCacheTotal": 1000,
  "queryParams": {
    "recentSalesDataLength": 1000
  }
}
```

## 背景情報

### 修正した内容
ファイル: `backend/src/routes/forecast.ts`

Supabaseのデフォルト1000件制限を回避するため、2つのクエリに `.limit(10000)` を追加：

1. **allStockDataクエリ**（行326-331）
```typescript
const { data: allStockData } = await supabase
  .from('stock_cache')
  .select('product_id, stock_amount')
  .in('store_id', [storeId])
  .limit(10000);  // ← 追加
```

2. **recentSalesDataクエリ**（行334-342）
```typescript
const { data: recentSalesData } = await supabase
  .from('sales_daily_summary')
  .select('product_id')
  .in('store_id', [storeId])
  .gte('sale_date', activeStartDate)
  .lte('sale_date', endDate)
  .limit(10000);  // ← 追加
```

### 修正の目的
- ユーザーのスマレジCSVでは店舗4（学芸大学店）に約1,600商品の売上がある
- APIは `activeProductCount: 985` を返していた
- 原因: Supabaseのデフォルト1000件制限で取得データが切り捨てられていた

## PR履歴

- PR #8: fix: allStockDataクエリにも.limit(10000)を追加 ← **これがデプロイされていない**
- PR #7: fix: Supabaseの1000件制限を回避するため.limit(10000)を追加
- PR #6: debug: クエリパラメータ確認用デバッグ情報追加
- PR #5: debug: activeProductCount乖離調査のためデバッグ情報追加
- PR #4: fix: .eq()を.in()に変更してstore_idクエリの型変換問題を修正

## 連絡先

問題が解決しない場合は、Claude Code セッションを再開してください。
Session ID: session_013nPrUWYMKoYH3diEguHQ5b
