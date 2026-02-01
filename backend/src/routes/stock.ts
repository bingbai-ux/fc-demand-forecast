import { Router } from 'express';
import { getStock, getStockSummary, StockSummary } from '../services/smaregi/stock';

const router = Router();

// メモリキャッシュ（5分間有効）
let cachedStock: Map<string, StockSummary> | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5分

// GET /api/stock - 在庫一覧取得
// クエリパラメータ: storeIds (カンマ区切り、例: 1,2,4)
router.get('/', async (req, res) => {
  try {
    const storeIdsParam = req.query.storeIds as string | undefined;
    const storeIds = storeIdsParam ? storeIdsParam.split(',') : undefined;
    
    const now = Date.now();
    
    // キャッシュキー（店舗IDの組み合わせ）
    const cacheKey = storeIds ? storeIds.sort().join(',') : 'all';
    
    // キャッシュが有効な場合（店舗指定なしの場合のみキャッシュ使用）
    if (!storeIds && cachedStock && (now - cacheTimestamp) < CACHE_DURATION) {
      console.log('📊 キャッシュから在庫一覧を返却');
      
      const stockArray = Array.from(cachedStock.values());
      return res.json({
        success: true,
        count: stockArray.length,
        cached: true,
        cacheAge: Math.round((now - cacheTimestamp) / 1000),
        storeIds: storeIds || 'all',
        data: stockArray,
      });
    }
    
    // 新規取得
    const stockSummary = await getStockSummary(storeIds);
    
    // キャッシュ更新（店舗指定なしの場合のみ）
    if (!storeIds) {
      cachedStock = stockSummary;
      cacheTimestamp = now;
    }
    
    const stockArray = Array.from(stockSummary.values());
    
    res.json({
      success: true,
      count: stockArray.length,
      cached: false,
      storeIds: storeIds || 'all',
      data: stockArray,
    });
  } catch (error: any) {
    console.error('在庫一覧取得エラー:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// POST /api/stock/refresh - キャッシュクリア＆再取得
router.post('/refresh', async (req, res) => {
  try {
    console.log('🔄 在庫キャッシュをクリアして再取得...');
    
    // キャッシュクリア
    cachedStock = null;
    cacheTimestamp = 0;
    
    // 再取得
    const stockSummary = await getStockSummary();
    
    // キャッシュ更新
    cachedStock = stockSummary;
    cacheTimestamp = Date.now();
    
    const stockArray = Array.from(stockSummary.values());
    
    res.json({
      success: true,
      count: stockArray.length,
      message: '在庫キャッシュを更新しました',
      data: stockArray,
    });
  } catch (error: any) {
    console.error('在庫キャッシュ更新エラー:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
