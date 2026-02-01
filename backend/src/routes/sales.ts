import { Router } from 'express';
import { getSales, ProductSalesSummary } from '../services/smaregi/sales';

const router = Router();

// メモリキャッシュ（キーは期間+店舗）
const salesCache = new Map<string, { data: ProductSalesSummary[]; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5分

// GET /api/sales - 売上集計取得
// クエリパラメータ:
//   from: 開始日 (YYYY-MM-DD) 必須
//   to: 終了日 (YYYY-MM-DD) 必須
//   storeIds: 店舗ID (カンマ区切り、例: 1,2,4) 省略時は全店舗
router.get('/', async (req, res) => {
  try {
    const fromDate = req.query.from as string;
    const toDate = req.query.to as string;
    const storeIdsParam = req.query.storeIds as string | undefined;
    
    // バリデーション
    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        error: 'from と to パラメータは必須です（YYYY-MM-DD形式）',
      });
    }
    
    // 日付形式チェック
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(fromDate) || !dateRegex.test(toDate)) {
      return res.status(400).json({
        success: false,
        error: '日付はYYYY-MM-DD形式で指定してください',
      });
    }
    
    const storeIds = storeIdsParam ? storeIdsParam.split(',') : undefined;
    
    // キャッシュキー
    const cacheKey = `${fromDate}_${toDate}_${storeIds?.sort().join(',') || 'all'}`;
    const now = Date.now();
    
    // キャッシュ確認
    const cached = salesCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      console.log('📈 キャッシュから売上データを返却');
      return res.json({
        success: true,
        count: cached.data.length,
        cached: true,
        cacheAge: Math.round((now - cached.timestamp) / 1000),
        period: { from: fromDate, to: toDate },
        storeIds: storeIds || 'all',
        data: cached.data,
      });
    }
    
    // 新規取得
    const sales = await getSales(fromDate, toDate, storeIds);
    
    // キャッシュ保存
    salesCache.set(cacheKey, { data: sales, timestamp: now });
    
    res.json({
      success: true,
      count: sales.length,
      cached: false,
      period: { from: fromDate, to: toDate },
      storeIds: storeIds || 'all',
      data: sales,
    });
  } catch (error: any) {
    console.error('売上集計取得エラー:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// DELETE /api/sales/cache - キャッシュクリア
router.delete('/cache', (req, res) => {
  salesCache.clear();
  console.log('🗑️ 売上キャッシュをクリアしました');
  res.json({
    success: true,
    message: '売上キャッシュをクリアしました',
  });
});

export default router;
