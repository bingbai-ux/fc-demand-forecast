-- abc_configテーブル作成（存在しなければ）
CREATE TABLE IF NOT EXISTS abc_config (
  rank VARCHAR(1) PRIMARY KEY,
  safety_stock_days DECIMAL(3,1) NOT NULL DEFAULT 0,
  algorithm VARCHAR(20) NOT NULL DEFAULT 'simple',
  threshold_max DECIMAL(5,2) NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 初期データ挿入（重複時更新）
INSERT INTO abc_config (rank, safety_stock_days, algorithm, threshold_max) VALUES
('A', 2.0, 'arima', 0.40),
('B', 1.0, 'arima', 0.65),
('C', 0.5, 'arima', 0.80),
('D', 0.0, 'simple', 0.92),
('E', 0.0, 'simple', 1.00)
ON CONFLICT (rank) DO UPDATE 
SET safety_stock_days = EXCLUDED.safety_stock_days,
    algorithm = EXCLUDED.algorithm,
    threshold_max = EXCLUDED.threshold_max,
    updated_at = NOW();

-- 確認
SELECT * FROM abc_config ORDER BY rank;
