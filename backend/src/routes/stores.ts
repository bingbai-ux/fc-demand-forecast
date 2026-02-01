import { Router } from 'express';
import { getStores } from '../services/smaregi/stores';

const router = Router();

// GET /api/stores - 店舗一覧取得
router.get('/', async (req, res) => {
  try {
    const stores = await getStores();
    res.json({
      success: true,
      count: stores.length,
      data: stores,
    });
  } catch (error: any) {
    console.error('店舗一覧取得エラー:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
