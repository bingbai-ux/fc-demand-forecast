-- ABCランク設定テーブル
CREATE TABLE IF NOT EXISTS abc_config (
  rank VARCHAR(1) PRIMARY KEY,
  safety_stock_days DECIMAL(3,1) NOT NULL DEFAULT 0,
  algorithm VARCHAR(20) NOT NULL DEFAULT 'simple',
  threshold_max DECIMAL(5,2) NOT NULL,
  min_order_lot INTEGER DEFAULT 1,
  label VARCHAR(20) NOT NULL,
  color_class VARCHAR(100) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 初期データ
INSERT INTO abc_config (rank, safety_stock_days, algorithm, threshold_max, min_order_lot, label, color_class) VALUES
('A', 2.0, 'arima', 0.40, 1, '最重要', 'bg-red-100 text-red-800'),
('B', 1.0, 'arima', 0.65, 1, '重要', 'bg-orange-100 text-orange-800'),
('C', 0.5, 'arima', 0.80, 1, '標準', 'bg-yellow-100 text-yellow-800'),
('D', 0.0, 'simple', 0.92, 1, '低優先', 'bg-green-100 text-green-800'),
('E', 0.0, 'simple', 1.00, 3, '最少', 'bg-gray-100 text-gray-600')
ON CONFLICT (rank) DO UPDATE SET
  safety_stock_days = EXCLUDED.safety_stock_days,
  algorithm = EXCLUDED.algorithm,
  updated_at = NOW();

-- 計算ログテーブル
CREATE TABLE IF NOT EXISTS order_calculation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id VARCHAR(50) NOT NULL,
  rank VARCHAR(1) NOT NULL,
  algorithm VARCHAR(20) NOT NULL,
  forecast_demand INTEGER NOT NULL,
  safety_stock INTEGER NOT NULL,
  current_stock INTEGER NOT NULL,
  suggested_order INTEGER NOT NULL,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calc_logs_date ON order_calculation_logs(calculated_at DESC);
