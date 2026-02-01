import { Router } from 'express';
import { getProductsWithCategory, ProductWithCategory } from '../services/smaregi/products';

const router = Router();

// メモリキャッシュ（5分間有効）
let cachedProducts: ProductWithCategory[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5分

// GET /api/products - 商品一覧取得
router.get('/', async (req, res) => {
  try {
    const now = Date.now();
    
    // キャッシュが有効な場合はキャッシュを返す
    if (cachedProducts && (now - cacheTimestamp) < CACHE_DURATION) {
      console.log('📦 キャッシュから商品一覧を返却');
      return res.json({
        success: true,
        count: cachedProducts.length,
        cached: true,
        cacheAge: Math.round((now - cacheTimestamp) / 1000),
        data: cachedProducts,
      });
    }
    
    // 新規取得
    const products = await getProductsWithCategory();
    
    // キャッシュ更新
    cachedProducts = products;
    cacheTimestamp = now;
    
    res.json({
      success: true,
      count: products.length,
      cached: false,
      data: products,
    });
  } catch (error: any) {
    console.error('商品一覧取得エラー:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// POST /api/products/refresh - キャッシュクリア＆再取得
router.post('/refresh', async (req, res) => {
  try {
    console.log('🔄 商品キャッシュをクリアして再取得...');
    
    // キャッシュクリア
    cachedProducts = null;
    cacheTimestamp = 0;
    
    // 再取得
    const products = await getProductsWithCategory();
    
    // キャッシュ更新
    cachedProducts = products;
    cacheTimestamp = Date.now();
    
    res.json({
      success: true,
      count: products.length,
      message: 'キャッシュを更新しました',
      data: products,
    });
  } catch (error: any) {
    console.error('商品キャッシュ更新エラー:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
