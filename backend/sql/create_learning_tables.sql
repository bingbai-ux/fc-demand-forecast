-- ============================================
-- 自動学習システム用テーブル
-- Supabase SQL Editor で実行
-- ============================================

-- 1. 予測スナップショット
-- 毎回の予測結果を保存し、後で実績と比較する
CREATE TABLE IF NOT EXISTS forecast_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  store_id        TEXT NOT NULL,
  product_id      TEXT NOT NULL,
  forecast_date   DATE NOT NULL,        -- 予測を実行した日
  period_start    DATE NOT NULL,        -- 予測対象期間の開始
  period_end      DATE NOT NULL,        -- 予測対象期間の終了
  predicted_quantity NUMERIC(10,1) NOT NULL DEFAULT 0,
  lookback_days   INTEGER NOT NULL DEFAULT 28,
  algorithm       TEXT DEFAULT 'simple',
  abc_rank        TEXT DEFAULT 'E',
  safety_stock    NUMERIC(10,1) DEFAULT 0,
  recommended_order INTEGER DEFAULT 0,
  evaluated       BOOLEAN DEFAULT FALSE, -- 精度評価済みか
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ユニーク制約（同じ店舗×商品×予測日の組み合わせ）
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_unique
  ON forecast_snapshots (store_id, product_id, forecast_date);

-- 未評価スナップショット検索用
CREATE INDEX IF NOT EXISTS idx_snapshots_unevaluated
  ON forecast_snapshots (evaluated, period_end)
  WHERE evaluated = FALSE;

-- 2. 精度メトリクス
-- 予測 vs 実績の比較結果
CREATE TABLE IF NOT EXISTS forecast_accuracy (
  id              BIGSERIAL PRIMARY KEY,
  store_id        TEXT NOT NULL,
  product_id      TEXT NOT NULL,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  predicted       NUMERIC(10,1) NOT NULL DEFAULT 0,
  actual          NUMERIC(10,1) NOT NULL DEFAULT 0,
  error           NUMERIC(10,1) NOT NULL DEFAULT 0, -- actual - predicted
  abs_error       NUMERIC(10,1) NOT NULL DEFAULT 0,
  mape            NUMERIC(8,4) DEFAULT 0,           -- |error|/actual
  bias            NUMERIC(8,4) DEFAULT 0,           -- (predicted-actual)/actual
  lookback_days   INTEGER DEFAULT 28,
  evaluated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accuracy_unique
  ON forecast_accuracy (store_id, product_id, period_start);

-- 時系列トレンド表示用
CREATE INDEX IF NOT EXISTS idx_accuracy_trend
  ON forecast_accuracy (store_id, period_start);

-- 3. 学習済みパラメータ
-- 商品×店舗ごとの最適化されたパラメータ
CREATE TABLE IF NOT EXISTS product_forecast_params (
  id                  BIGSERIAL PRIMARY KEY,
  store_id            TEXT NOT NULL,
  product_id          TEXT NOT NULL,
  bias_correction     NUMERIC(6,4) DEFAULT 1.0,    -- 0.80〜1.20
  safety_multiplier   NUMERIC(6,4) DEFAULT 1.0,    -- 0.50〜2.00
  best_lookback_days  INTEGER DEFAULT 28,           -- 14/28/42/56
  dow_reliability     NUMERIC(6,4) DEFAULT 1.0,    -- 0.0〜1.0
  weekly_mape         NUMERIC(8,4) DEFAULT 0,       -- 直近MAPE
  weekly_bias         NUMERIC(8,4) DEFAULT 0,       -- 直近バイアス
  stockout_rate_7d    NUMERIC(6,4) DEFAULT 0,       -- 直近欠品率
  learning_cycles     INTEGER DEFAULT 0,            -- 学習回数
  last_learned_at     TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_params_unique
  ON product_forecast_params (store_id, product_id);

-- 学習回数の多い商品を確認する用
CREATE INDEX IF NOT EXISTS idx_params_cycles
  ON product_forecast_params (learning_cycles DESC);

-- ============================================
-- RLS（Row Level Security）はサービスロールキーを使用するため不要
-- ============================================

-- ============================================
-- 古いデータの自動クリーンアップ（オプション）
-- 90日以上前のスナップショットを削除
-- Supabaseのpg_cronまたは手動で定期実行
-- ============================================
-- DELETE FROM forecast_snapshots WHERE created_at < NOW() - INTERVAL '90 days';
-- DELETE FROM forecast_accuracy WHERE evaluated_at < NOW() - INTERVAL '180 days';
