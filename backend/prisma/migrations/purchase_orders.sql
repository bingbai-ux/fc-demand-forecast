-- 発注済未入庫管理テーブル
CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  product_id VARCHAR(50) NOT NULL,
  store_id VARCHAR(50) NOT NULL,
  supplier_id VARCHAR(50),
  quantity INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) DEFAULT 'ordered',
  order_date DATE DEFAULT CURRENT_DATE,
  expected_delivery DATE,
  received_date DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- インデックス作成（検索高速化）
CREATE INDEX IF NOT EXISTS idx_po_product_status ON purchase_orders(product_id, status);
CREATE INDEX IF NOT EXISTS idx_po_store_status ON purchase_orders(store_id, status);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);

-- テストデータ挿入（開発用）
INSERT INTO purchase_orders (product_id, store_id, supplier_id, quantity, status, order_date)
SELECT 
  'TEST-' || i,
  'store-001',
  'supplier-001',
  10,
  'ordered',
  CURRENT_DATE - (i % 7)
FROM generate_series(1, 5) AS i
ON CONFLICT DO NOTHING;

-- 確認
SELECT product_id, quantity, status, order_date 
FROM purchase_orders 
WHERE status = 'ordered' 
LIMIT 10;
