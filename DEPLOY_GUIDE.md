# 需要予測 統合版 デプロイガイド

## このzipの内容

現在デプロイ済みのコードベースに以下の変更を適用済みです。
**このzipの中身でリポジトリを丸ごと置き換えて** git push するだけでデプロイ完了します。

### 変更点サマリー

| 操作 | ファイル | 内容 |
|------|---------|------|
| **新規追加** | `backend/src/services/forecast-engine.ts` | 統合予測エンジン（819行） |
| **新規追加** | `backend/src/services/forecast-learner.ts` | 自動学習エンジン（656行） |
| **置換** | `backend/src/routes/forecast.ts` | 統合APIルート（496行） |
| **置換** | `backend/src/config/abc-ranks.ts` | ABC分析設定（150行） |
| **修正** | `backend/src/index.ts` | V2削除 + 学習ジョブ追加 |
| **置換** | `frontend/src/api/forecast.ts` | 統合版APIクライアント |
| **削除済** | `backend/src/routes/forecast-v2.ts` | V2ルート（不要） |
| **削除済** | `backend/src/services/arima-forecast.ts` | ARIMA（未使用） |
| **削除済** | `backend/src/services/order-calculator-v2.ts` | V2計算機（不要） |
| **新規追加** | `backend/sql/create_learning_tables.sql` | DB学習テーブル |

---

## デプロイ手順

### Step 1: SQLテーブル作成（Supabase）

**Supabaseダッシュボード → SQL Editor** で以下を実行：

`backend/sql/create_learning_tables.sql` の内容をコピペして実行。

3つのテーブルが作成されます：
- `forecast_snapshots` — 予測スナップショット
- `forecast_accuracy` — 精度メトリクス
- `product_forecast_params` — 学習済みパラメータ

> ⚠️ SQLを実行しなくてもアプリは動きます（学習機能がスキップされるだけ）。
> ただし、精度改善の自動学習を使うにはテーブルが必要です。

### Step 2: コードをプッシュ

```bash
# リポジトリのルートで実行
# 既存ファイルを全削除してzipの中身で置換
git add -A
git commit -m "feat: 需要予測V1/V2統合 + 自動学習エンジン追加"
git push origin main
```

Railway が自動デプロイします。

### Step 3: 動作確認

デプロイ完了後、以下のエンドポイントを確認：

```bash
# ヘルスチェック
curl https://your-backend.railway.app/api/health

# 予測計算テスト（Store 2で7日予測）
curl -X POST https://your-backend.railway.app/api/forecast/calculate \
  -H "Content-Type: application/json" \
  -d '{
    "storeId": "2",
    "supplierNames": [],
    "orderDate": "2026-02-02",
    "forecastDays": 7,
    "lookbackDays": 28
  }'
```

---

## 主な改善点

1. **安全在庫が発注量に反映** — 旧コードでは計算のみで発注に含まれていなかった
2. **リードタイム需要を考慮** — 仕入れまでの日数分の需要を加算
3. **曜日別需要パターン** — 週末と平日の売れ方の違いを反映
4. **ABC分析の統一** — 1回だけ計算し、安全在庫と表示で同じランクを使用
5. **Supabase 1000行ページネーション** — 大量データでもデータ欠落なし
6. **自動学習** — 予測精度を自動評価し、パラメータを日々最適化

---

## 注意事項

- `services/forecast.ts`（旧V1）は `backtest.ts` が依存しているため残してあります
- 旧 `/api/v2/forecast/` エンドポイントは廃止されました（フロントエンド側も更新済み）
- 環境変数の追加は不要です
