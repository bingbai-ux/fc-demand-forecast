# 需要予測ロジック 統合設計書

**作成日**: 2026-02-01  
**目的**: V1/V2を統合し、FOOD&COMPANYの発注業務に最適化された単一の予測エンジンを構築

---

## 1. 変更概要

### ファイル構成

| 種別 | ファイル | 行数 | 役割 |
|------|---------|------|------|
| **新規** | `services/forecast-engine.ts` | 476 | 計算ロジック本体 |
| **書換** | `routes/forecast.ts` | 357 | HTTPルーティングのみ |
| **書換** | `config/abc-ranks.ts` | 130 | ABC設定（唯一の定義） |
| **書換** | `frontend/src/api/forecast.ts` | 90 | フロントエンドAPIクライアント |
| **削除** | `routes/forecast-v2.ts` | — | V2ルート（死コード） |
| **削除** | `services/arima-forecast.ts` | — | 偽ARIMA実装 |
| **削除** | `services/order-calculator-v2.ts` | — | V2計算機 |
| **修正** | `index.ts` | 2行 | V2ルート登録を削除 |

**旧: 2,249行（5ファイル） → 新: 1,473行（4ファイル）**  
34%のコード削減。死コード・重複ロジック・矛盾をすべて排除。

---

## 2. 発注計算式

### 旧V1

```
recommendedOrder = max(0, ceil(avgDailySales × forecastDays - currentStock))
```

**問題点**:
- 安全在庫なし（breakdownには表示されるが計算に使われない）
- リードタイム考慮なし
- 曜日パターン無視
- ABCランクが2回計算され結果が不一致

### 新・統合版

```
recommendedOrder = max(0, ceil(
  (forecastDemand + leadTimeDemand + safetyStock - currentStock) / lotSize
)) × lotSize
```

各項の定義:

| 項目 | 計算方法 | 説明 |
|------|---------|------|
| **forecastDemand** | Σ(baseRate × dowIndex[曜日]) | 予測期間の合計需要 |
| **leadTimeDemand** | avgDaily × leadTimeDays | 入荷待ち期間の消費 |
| **safetyStock** | min(z × σ × √LT, maxDays × avg) | ABC別の安全バッファ |
| **currentStock** | stock_cacheから取得 | 現在庫 |

**breakdownテキストと実際の計算が完全一致**します。

---

## 3. 曜日別需要予測（加重曜日インデックス法）

食品小売で最も効果的な改善。土日に売上が集中するパターンを捕捉します。

### 計算手順

**Step 1: 曜日インデックス計算（12週分のデータから）**

```
各曜日の平均売上 / 全曜日平均 = インデックス（1.0が平均）

例:
  月: 0.75  火: 0.70  水: 0.85
  木: 0.95  金: 1.15  土: 1.35  日: 1.25
  → 土日で全体の37%を占める
```

**Step 2: ベースレート計算（直近lookbackDaysから、指数加重）**

```
各日の売上を曜日インデックスで除算（季節性除去）
→ 指数加重平均（直近ほど重みが大きい）
→ ベースレート（曜日無関係の「基礎日販」）
```

**Step 3: 予測**

```
各予測日: predicted = baseRate × dowIndex[その日の曜日]

例: 予測7日間（月〜日）
  月: 2.0×0.75=1.5  火: 2.0×0.70=1.4  水: 2.0×0.85=1.7
  木: 2.0×0.95=1.9  金: 2.0×1.15=2.3  土: 2.0×1.35=2.7  日: 2.0×1.25=2.5
  合計: 14.0個
```

### フォールバック条件

以下の場合は単純移動平均にフォールバック:
- D/Eランク商品（データが少なく曜日パターンが不安定）
- データポイントが14日未満
- 曜日インデックスの変動が小さい（全て0.75〜1.25の範囲内）

---

## 4. 安全在庫

### 計算式

```
safetyStock = min(
  z_score × σ_daily × √(leadTimeDays),   ← 統計的安全在庫
  maxSafetyDays × avgDailySales           ← 実用的な上限
)
```

### ABCランク別パラメータ

| ランク | z-score | サービス率 | 上限(日) | アルゴリズム |
|--------|---------|-----------|---------|-------------|
| A | 1.65 | 95% | 3日 | 曜日加重 |
| B | 1.28 | 90% | 2日 | 曜日加重 |
| C | 0.84 | 80% | 1日 | 曜日加重 |
| D | 0 | — | 0日 | 単純平均 |
| E | 0 | — | 0日 | 単純平均 |

**設計根拠**:
- A商品の欠品は売上への影響大 → 95%カバー
- 食品は賞味期限があるため、上限キャップで過剰在庫を防止
- D/Eは欠品しても影響軽微 → 安全在庫なしで在庫コスト削減

---

## 5. ABC分析

### 旧コードの問題

```
1回目: 日販の絶対値で判定（A≥3個, B≥1.5個, ...）
  → この結果で安全在庫を計算

2回目: 累積構成比で判定（パレート分析）
  → この結果でユーザー表示を上書き

結果: 表示ランクと安全在庫の根拠が不一致
```

### 新コード

**1回だけ計算（累積売上金額ベース）。全箇所で同一のランクを使用。**

```
① 商品を売上金額（日販 × 小売価格）で降順ソート
② 累積構成比を計算
③ 閾値に基づきランク割当
   A: 〜50%  B: 〜75%  C: 〜90%  D: 〜97%  E: 残り
④ 全商品が売上ゼロの場合 → 順位ベースで割当
```

---

## 6. Supabase 1000行制限の対策

### 旧コード

```typescript
// ❌ 500商品×14日 = 最大7,000行 → 1,000行で打ち切り
const { data } = await supabase
  .from('sales_daily_summary')
  .in('product_id', chunk_500)
  .gte('sale_date', from).lte('sale_date', to);
```

### 新コード

```typescript
// ✅ 100商品ずつ + .range()ページネーション
async function fetchByProductIds(table, select, productIds, extraFilters) {
  for (chunk of productIds, size=100) {       // .in()を100件ずつ
    await fetchAll(table, select, filters);    // .range()で全行取得
  }
}

async function fetchAll(table, select, filters) {
  while (true) {
    const { data } = await query.range(offset, offset + 999);
    if (data.length < 1000) break;             // 全行取得するまで繰り返し
    offset += 1000;
  }
}
```

**全DBクエリがこのパターンを通る**ため、データ欠落は発生しません。

---

## 7. タイムゾーン対策

### 旧コード

```typescript
// ❌ UTC
const dateStr = new Date().toISOString().split('T')[0];
// JST 2026-02-01 08:00 → UTC 2026-01-31 23:00 → "2026-01-31"
```

### 新コード

```typescript
// ✅ JST固定
export function todayJST(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().split('T')[0];
}
```

日付計算は全て `addDays()` ユーティリティを通し、UTCの noon（12:00）を基準にすることでタイムゾーン境界の問題を回避。

---

## 8. 異常検知の改善

| 検知項目 | 旧 | 新 |
|---------|-----|-----|
| 欠品 | ✅ 在庫0 & 日販>0 | ✅ 同左 |
| 在庫少 | ✅ 在庫日数<3 | ✅ 同左 |
| 在庫過剰 | ✅ 在庫日数>30 | ✅ 同左 |
| 売上急増 | ⚠️ 直近1日 vs 全体平均×1.5 | ✅ **直近3日平均** vs 全体平均×**2.0** |

旧コードは1日の売上だけで「急増」と判定するため、ノイズが多すぎました。
新コードは3日間の移動平均で比較し、閾値も2.0倍に引き上げ。

---

## 9. フロントエンド互換性

### レスポンス形式

`POST /api/forecast/calculate` のレスポンスは **既存フロントエンドと互換**:

```json
{
  "success": true,
  "supplierGroups": [{ "supplierName": "...", "products": [...], ... }],
  "summary": { "totalProducts": 100, "totalOrderQuantity": 500, ... },
  "abcSummary": { "A": { "count": 10, "salesRatio": 50 }, ... },
  "anomalySummary": { "stockout": 3, "low_stock": 5, ... },
  "stockoutCost": { "totalLoss": 15000, ... },
  "pastSalesType": "daily",
  "pastSalesDates": ["1/25", "1/26", ...],
  "debug": { ... }
}
```

商品オブジェクトのフィールドも維持:
- `rank`, `abcRank` — 同じ値（後方互換のため両方残す）
- `alertFlags`, `anomalies` — 同じ値
- `hasAnomaly`, `isAnomaly` — 同じ値
- `algorithm` — `'weighted_dow'` or `'simple'`（旧`'arima'`は廃止）

**`DemandForecast.tsx` の変更は不要**です。

### 削除されたエンドポイント

| エンドポイント | 状態 | 理由 |
|-------------|------|------|
| `POST /api/v2/forecast/calculate` | 削除 | フロントから呼ばれていなかった |
| `GET /api/v2/forecast/abc-config` | 削除 | 同上 |
| `GET /api/v2/forecast/stats` | 削除 | 同上 |
| `POST /api/forecast/backtest-with-gaps` | 削除 | N+1クエリ問題・シミュレーションが無意味だった |

バックテストは将来、バックグラウンドジョブとして再実装を推奨。

---

## 10. 具体的な発注例

### 商品: オーガニック牛乳（Aランク）

| パラメータ | 値 |
|-----------|-----|
| ベースレート | 3.2個/日 |
| 曜日インデックス | [月0.8, 火0.7, 水0.9, 木1.0, 金1.2, 土1.4, 日1.3] |
| 予測7日間（月〜日） | 2.6+2.2+2.9+3.2+3.8+4.5+4.2 = **23.4個** |
| リードタイム（2日） | 3.2 × 2 = **6.4個** |
| σ_daily | 1.8個 |
| 安全在庫 | min(1.65×1.8×√2, 3×3.2) = min(**4.2**, 9.6) = **4個** |
| 現在庫 | 12個 |
| 純需要 | 23.4 + 6.4 + 4 - 12 = **21.8個** |
| ロット（6個単位） | ceil(21.8/6)×6 = **24個** |

**breakdown**: `予測23.4 + LT6.4 + 安全4 - 在庫12 = 純需要21.8`

### 旧V1との差分

| | 旧V1 | 新・統合版 |
|---|------|-----------|
| 予測需要 | 3.2×7 = 22.4 | 23.4（曜日考慮で+1） |
| リードタイム | 0（考慮なし） | 6.4 |
| 安全在庫 | 0（計算されない） | 4 |
| 純需要 | 22.4-12 = 10.4 | 21.8 |
| 発注数 | 12個 | **24個** |

旧V1は12個しか発注しないため、**リードタイム中に欠品が発生**。
新版は24個発注し、次回発注日まで在庫を維持できる。

---

## 11. デプロイ手順

```bash
# 1. 変更ファイルの確認
git diff --stat

# 2. TypeScriptコンパイル確認
cd backend && npx tsc --noEmit

# 3. ステージング環境でテスト
# POST /api/forecast/calculate を既存のパラメータで呼び出し
# レスポンス形式が変わっていないことを確認

# 4. 本番デプロイ
git add -A
git commit -m "refactor: V1/V2需要予測ロジック統合 - 曜日別予測・安全在庫・ページネーション修正"
git push
```

### 動作確認チェックリスト

- [ ] `/api/forecast/calculate` が正常にレスポンスを返す
- [ ] `supplierGroups` の形式が変わっていない
- [ ] `breakdown` テキストが `予測X + LTY + 安全Z - 在庫W = 純需要N` の形式
- [ ] `algorithm` が `weighted_dow` または `simple`（`arima`は出ない）
- [ ] 500商品以上の仕入先でもデータが欠落しない
- [ ] ABCランクが `rank` と `abcRank` で同じ値
- [ ] 店舗一覧・仕入先一覧が正常動作
- [ ] フロントエンドの予測画面が正常表示
