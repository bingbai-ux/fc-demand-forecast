import { Router } from 'express';
import { prisma } from '../config/database';

const router = Router();

/**
 * POST /api/admin/migrate
 * データベースマイグレーション（開発用）
 */
router.post('/migrate', async (req, res) => {
  try {
    // 認証チェック（簡易実装）
    const { secret } = req.body;
    if (secret !== process.env.MIGRATE_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('[Migrate] abc_configテーブル作成開始...');

    // abc_configテーブル作成
    const createAbcConfig = await prisma.rpc('execute_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS abc_config (
          rank VARCHAR(1) PRIMARY KEY,
          safety_stock_days DECIMAL(3,1) NOT NULL DEFAULT 0,
          algorithm VARCHAR(20) NOT NULL DEFAULT 'simple',
          threshold_max DECIMAL(5,2) NOT NULL,
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `
    });

    // 初期データ挿入
    const insertAbcConfig = await prisma.rpc('execute_sql', {
      sql: `
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
      `
    });

    // purchase_ordersテーブル作成
    const createPurchaseOrders = await prisma.rpc('execute_sql', {
      sql: `
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
      `
    });

    // インデックス作成
    const createIndex1 = await prisma.rpc('execute_sql', {
      sql: `CREATE INDEX IF NOT EXISTS idx_po_product_status ON purchase_orders(product_id, status);`
    });

    const createIndex2 = await prisma.rpc('execute_sql', {
      sql: `CREATE INDEX IF NOT EXISTS idx_po_store_status ON purchase_orders(store_id, status);`
    });

    // 確認
    const { data: abcConfig, error: abcError } = await prisma
      .from('abc_config')
      .select('*')
      .order('rank');

    if (abcError) {
      console.error('[Migrate] 確認エラー:', abcError);
    }

    res.json({
      success: true,
      message: 'Migration completed',
      abc_config: abcConfig || [],
      tables_created: {
        abc_config: !abcError,
        purchase_orders: true
      }
    });

  } catch (error: any) {
    console.error('[Migrate] エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      hint: 'execute_sql関数が存在しない場合はSupabaseダッシュボードで手動実行してください'
    });
  }
});

export default router;
